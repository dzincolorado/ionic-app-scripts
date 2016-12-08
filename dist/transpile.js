"use strict";
var interfaces_1 = require('./util/interfaces');
var logger_1 = require('./util/logger');
var bundle_1 = require('./bundle');
var helpers_1 = require('./util/helpers');
var events_1 = require('events');
var config_1 = require('./util/config');
var template_1 = require('./template');
var fs_1 = require('fs');
var logger_typescript_1 = require('./util/logger-typescript');
var logger_diagnostics_1 = require('./util/logger-diagnostics');
var child_process_1 = require('child_process');
var path = require('path');
var ts = require('typescript');
function transpile(context) {
    context = config_1.generateContext(context);
    var workerConfig = {
        configFile: getTsConfigPath(context),
        writeInMemory: true,
        sourceMaps: true,
        cache: true,
        inlineTemplate: context.inlineTemplates
    };
    var logger = new logger_1.Logger('transpile');
    return transpileWorker(context, workerConfig)
        .then(function () {
        context.transpileState = interfaces_1.BuildState.SuccessfulBuild;
        logger.finish();
    })
        .catch(function (err) {
        context.transpileState = interfaces_1.BuildState.RequiresBuild;
        throw logger.fail(err);
    });
}
exports.transpile = transpile;
function transpileUpdate(event, filePath, context) {
    var workerConfig = {
        configFile: getTsConfigPath(context),
        writeInMemory: true,
        sourceMaps: true,
        cache: false,
        inlineTemplate: context.inlineTemplates
    };
    var logger = new logger_1.Logger('transpile update');
    return transpileUpdateWorker(event, filePath, context, workerConfig)
        .then(function (tsFiles) {
        context.transpileState = interfaces_1.BuildState.SuccessfulBuild;
        logger.finish();
    })
        .catch(function (err) {
        context.transpileState = interfaces_1.BuildState.RequiresBuild;
        throw logger.fail(err);
    });
}
exports.transpileUpdate = transpileUpdate;
/**
 * The full TS build for all app files.
 */
function transpileWorker(context, workerConfig) {
    // let's do this
    return new Promise(function (resolve, reject) {
        logger_diagnostics_1.clearDiagnostics(context, logger_diagnostics_1.DiagnosticsType.TypeScript);
        // get the tsconfig data
        var tsConfig = getTsConfig(context, workerConfig.configFile);
        if (workerConfig.sourceMaps === false) {
            // the worker config say, "hey, don't ever bother making a source map, because."
            tsConfig.options.sourceMap = false;
        }
        else {
            // build the ts source maps if the bundler is going to use source maps
            tsConfig.options.sourceMap = bundle_1.buildJsSourceMaps(context);
        }
        // collect up all the files we need to transpile, tsConfig itself does all this for us
        var tsFileNames = cleanFileNames(context, tsConfig.fileNames);
        // for dev builds let's not create d.ts files
        tsConfig.options.declaration = undefined;
        // let's start a new tsFiles object to cache all the transpiled files in
        var host = ts.createCompilerHost(tsConfig.options);
        var program = ts.createProgram(tsFileNames, tsConfig.options, host, cachedProgram);
        program.emit(undefined, function (path, data, writeByteOrderMark, onError, sourceFiles) {
            if (workerConfig.writeInMemory) {
                writeSourceFiles(context.fileCache, sourceFiles);
                writeTranspiledFilesCallback(context.fileCache, path, data, workerConfig.inlineTemplate);
            }
        });
        // cache the typescript program for later use
        cachedProgram = program;
        var tsDiagnostics = program.getSyntacticDiagnostics()
            .concat(program.getSemanticDiagnostics())
            .concat(program.getOptionsDiagnostics());
        var diagnostics = logger_typescript_1.runTypeScriptDiagnostics(context, tsDiagnostics);
        if (diagnostics.length) {
            // darn, we've got some things wrong, transpile failed :(
            logger_diagnostics_1.printDiagnostics(context, logger_diagnostics_1.DiagnosticsType.TypeScript, diagnostics, true, true);
            reject(new logger_1.BuildError());
        }
        else {
            // transpile success :)
            resolve();
        }
    });
}
exports.transpileWorker = transpileWorker;
function canRunTranspileUpdate(event, filePath, context) {
    if (event === 'change' && context.fileCache) {
        return context.fileCache.has(path.resolve(filePath));
    }
    return false;
}
exports.canRunTranspileUpdate = canRunTranspileUpdate;
/**
 * Iterative build for one TS file. If it's not an existing file change, or
 * something errors out then it falls back to do the full build.
 */
function transpileUpdateWorker(event, filePath, context, workerConfig) {
    return new Promise(function (resolve, reject) {
        logger_diagnostics_1.clearDiagnostics(context, logger_diagnostics_1.DiagnosticsType.TypeScript);
        filePath = path.resolve(filePath);
        // an existing ts file we already know about has changed
        // let's "TRY" to do a single module build for this one file
        var tsConfig = getTsConfig(context, workerConfig.configFile);
        // build the ts source maps if the bundler is going to use source maps
        tsConfig.options.sourceMap = bundle_1.buildJsSourceMaps(context);
        var transpileOptions = {
            compilerOptions: tsConfig.options,
            fileName: filePath,
            reportDiagnostics: true
        };
        // let's manually transpile just this one ts file
        // load up the source text for this one module
        var sourceText = fs_1.readFileSync(filePath, 'utf8');
        // transpile this one module
        var transpileOutput = ts.transpileModule(sourceText, transpileOptions);
        var diagnostics = logger_typescript_1.runTypeScriptDiagnostics(context, transpileOutput.diagnostics);
        if (diagnostics.length) {
            logger_diagnostics_1.printDiagnostics(context, logger_diagnostics_1.DiagnosticsType.TypeScript, diagnostics, false, true);
            // darn, we've got some errors with this transpiling :(
            // but at least we reported the errors like really really fast, so there's that
            logger_1.Logger.debug("transpileUpdateWorker: transpileModule, diagnostics: " + diagnostics.length);
            reject(new logger_1.BuildError());
        }
        else {
            // convert the path to have a .js file extension for consistency
            var newPath = helpers_1.changeExtension(filePath, '.js');
            var sourceMapFile = { path: newPath + '.map', content: transpileOutput.sourceMapText };
            var jsContent = transpileOutput.outputText;
            if (workerConfig.inlineTemplate) {
                // use original path for template inlining
                jsContent = template_1.inlineTemplate(transpileOutput.outputText, filePath);
            }
            var jsFile = { path: newPath, content: jsContent };
            var tsFile = { path: filePath, content: sourceText };
            context.fileCache.set(sourceMapFile.path, sourceMapFile);
            context.fileCache.set(jsFile.path, jsFile);
            context.fileCache.set(tsFile.path, tsFile);
            resolve();
        }
    });
}
function transpileDiagnosticsOnly(context) {
    return new Promise(function (resolve) {
        workerEvent.once('DiagnosticsWorkerDone', function () {
            resolve();
        });
        runDiagnosticsWorker(context);
    });
}
exports.transpileDiagnosticsOnly = transpileDiagnosticsOnly;
var workerEvent = new events_1.EventEmitter();
var diagnosticsWorker = null;
function runDiagnosticsWorker(context) {
    if (!diagnosticsWorker) {
        var workerModule = path.join(__dirname, 'transpile-worker.js');
        diagnosticsWorker = child_process_1.fork(workerModule, [], { env: { FORCE_COLOR: true } });
        logger_1.Logger.debug("diagnosticsWorker created, pid: " + diagnosticsWorker.pid);
        diagnosticsWorker.on('error', function (err) {
            logger_1.Logger.error("diagnosticsWorker error, pid: " + diagnosticsWorker.pid + ", error: " + err);
            workerEvent.emit('DiagnosticsWorkerDone');
        });
        diagnosticsWorker.on('exit', function (code) {
            logger_1.Logger.debug("diagnosticsWorker exited, pid: " + diagnosticsWorker.pid);
            diagnosticsWorker = null;
        });
        diagnosticsWorker.on('message', function (msg) {
            workerEvent.emit('DiagnosticsWorkerDone');
        });
    }
    var msg = {
        rootDir: context.rootDir,
        buildDir: context.buildDir,
        isProd: context.isProd,
        configFile: getTsConfigPath(context)
    };
    diagnosticsWorker.send(msg);
}
function cleanFileNames(context, fileNames) {
    // make sure we're not transpiling the prod when dev and stuff
    var removeFileName = (context.isProd) ? 'main.dev.ts' : 'main.prod.ts';
    return fileNames.filter(function (f) { return (f.indexOf(removeFileName) === -1); });
}
function writeSourceFiles(fileCache, sourceFiles) {
    for (var _i = 0, sourceFiles_1 = sourceFiles; _i < sourceFiles_1.length; _i++) {
        var sourceFile = sourceFiles_1[_i];
        fileCache.set(sourceFile.fileName, { path: sourceFile.fileName, content: sourceFile.text });
    }
}
function writeTranspiledFilesCallback(fileCache, sourcePath, data, shouldInlineTemplate) {
    sourcePath = path.normalize(sourcePath);
    if (sourcePath.endsWith('.js')) {
        sourcePath = sourcePath.substring(0, sourcePath.length - 3) + '.js';
        var file = fileCache.get(sourcePath);
        if (!file) {
            file = { content: '', path: sourcePath };
        }
        if (shouldInlineTemplate) {
            file.content = template_1.inlineTemplate(data, sourcePath);
        }
        else {
            file.content = data;
        }
        fileCache.set(sourcePath, file);
    }
    else if (sourcePath.endsWith('.js.map')) {
        sourcePath = sourcePath.substring(0, sourcePath.length - 7) + '.js.map';
        var file = fileCache.get(sourcePath);
        if (!file) {
            file = { content: '', path: sourcePath };
        }
        file.content = data;
        fileCache.set(sourcePath, file);
    }
}
function getTsConfig(context, tsConfigPath) {
    var config = null;
    tsConfigPath = tsConfigPath || getTsConfigPath(context);
    var tsConfigFile = ts.readConfigFile(tsConfigPath, function (path) { return fs_1.readFileSync(path, 'utf8'); });
    if (!tsConfigFile) {
        throw new logger_1.BuildError("tsconfig: invalid tsconfig file, \"" + tsConfigPath + "\"");
    }
    else if (tsConfigFile.error && tsConfigFile.error.messageText) {
        throw new logger_1.BuildError("tsconfig: " + tsConfigFile.error.messageText);
    }
    else if (!tsConfigFile.config) {
        throw new logger_1.BuildError("tsconfig: invalid config, \"" + tsConfigPath + "\"\"");
    }
    else {
        var parsedConfig = ts.parseJsonConfigFileContent(tsConfigFile.config, ts.sys, context.rootDir, {}, tsConfigPath);
        var diagnostics = logger_typescript_1.runTypeScriptDiagnostics(context, parsedConfig.errors);
        if (diagnostics.length) {
            logger_diagnostics_1.printDiagnostics(context, logger_diagnostics_1.DiagnosticsType.TypeScript, diagnostics, true, true);
            throw new logger_1.BuildError();
        }
        config = {
            options: parsedConfig.options,
            fileNames: parsedConfig.fileNames,
            typingOptions: parsedConfig.typingOptions,
            raw: parsedConfig.raw
        };
    }
    return config;
}
exports.getTsConfig = getTsConfig;
var cachedProgram = null;
function getTsConfigPath(context) {
    return path.join(context.rootDir, 'tsconfig.json');
}
exports.getTsConfigPath = getTsConfigPath;
