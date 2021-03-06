"use strict";
var buildTask = require('./build');
var interfaces_1 = require('./util/interfaces');
var logger_1 = require('./util/logger');
var config_1 = require('./util/config');
var path_1 = require('path');
var transpile_1 = require('./transpile');
var chokidar = require('chokidar');
// https://github.com/paulmillr/chokidar
function watch(context, configFile) {
    context = config_1.generateContext(context);
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    // force watch options
    context.isProd = false;
    context.isWatch = true;
    context.sassState = interfaces_1.BuildState.RequiresBuild;
    context.transpileState = interfaces_1.BuildState.RequiresBuild;
    context.bundleState = interfaces_1.BuildState.RequiresBuild;
    var logger = new logger_1.Logger('watch');
    function buildDone() {
        return startWatchers(context, configFile).then(function () {
            logger.ready();
        });
    }
    return buildTask.build(context)
        .then(buildDone, buildDone)
        .catch(function (err) {
        throw logger.fail(err);
    });
}
exports.watch = watch;
function startWatchers(context, configFile) {
    var watchConfig = config_1.fillConfigDefaults(configFile, taskInfo.defaultConfigFile);
    var promises = watchConfig
        .watchers
        .map(function (w, i) { return startWatcher(i, w, context, watchConfig); });
    return Promise.all(promises);
}
function startWatcher(index, watcher, context, watchConfig) {
    return new Promise(function (resolve, reject) {
        prepareWatcher(context, watcher);
        if (!watcher.paths) {
            logger_1.Logger.error("watcher config, index " + index + ": missing \"paths\"");
            resolve();
            return;
        }
        if (!watcher.callback) {
            logger_1.Logger.error("watcher config, index " + index + ": missing \"callback\"");
            resolve();
            return;
        }
        var chokidarWatcher = chokidar.watch(watcher.paths, watcher.options);
        var eventName = 'all';
        if (watcher.eventName) {
            eventName = watcher.eventName;
        }
        chokidarWatcher.on(eventName, function (event, filePath) {
            // if you're listening for a specific event vs 'all',
            // the event is not included and the first param is the filePath
            // go ahead and adjust it if filePath is null so it's uniform
            if (!filePath) {
                filePath = event;
                event = watcher.eventName;
            }
            config_1.setIonicEnvironment(context.isProd);
            filePath = path_1.join(context.rootDir, filePath);
            logger_1.Logger.debug("watch callback start, id: " + watchCount + ", isProd: " + context.isProd + ", event: " + event + ", path: " + filePath);
            var callbackToExecute = function (event, filePath, context, watcher) {
                return watcher.callback(event, filePath, context);
            };
            callbackToExecute(event, filePath, context, watcher)
                .then(function () {
                logger_1.Logger.debug("watch callback complete, id: " + watchCount + ", isProd: " + context.isProd + ", event: " + event + ", path: " + filePath);
                watchCount++;
            })
                .catch(function (err) {
                logger_1.Logger.debug("watch callback error, id: " + watchCount + ", isProd: " + context.isProd + ", event: " + event + ", path: " + filePath);
                logger_1.Logger.debug("" + err);
                watchCount++;
            });
        });
        chokidarWatcher.on('ready', function () {
            logger_1.Logger.debug("watcher ready: " + watcher.options.cwd + watcher.paths);
            resolve();
        });
        chokidarWatcher.on('error', function (err) {
            reject(new logger_1.BuildError("watcher error: " + watcher.options.cwd + watcher.paths + ": " + err));
        });
    });
}
function prepareWatcher(context, watcher) {
    watcher.options = watcher.options || {};
    if (!watcher.options.cwd) {
        watcher.options.cwd = context.rootDir;
    }
    if (typeof watcher.options.ignoreInitial !== 'boolean') {
        watcher.options.ignoreInitial = true;
    }
    if (typeof watcher.options.ignored === 'string') {
        watcher.options.ignored = path_1.normalize(config_1.replacePathVars(context, watcher.options.ignored));
    }
    if (typeof watcher.paths === 'string') {
        watcher.paths = path_1.normalize(config_1.replacePathVars(context, watcher.paths));
    }
    else if (Array.isArray(watcher.paths)) {
        watcher.paths = watcher.paths.map(function (p) { return path_1.normalize(config_1.replacePathVars(context, p)); });
    }
}
exports.prepareWatcher = prepareWatcher;
var queuedChangedFiles = [];
var queuedChangeFileTimerId;
function buildUpdate(event, filePath, context) {
    var changedFile = {
        event: event,
        filePath: filePath,
        ext: path_1.extname(filePath).toLowerCase()
    };
    // do not allow duplicates
    if (!queuedChangedFiles.some(function (f) { return f.filePath === filePath; })) {
        queuedChangedFiles.push(changedFile);
        // debounce our build update incase there are multiple files
        clearTimeout(queuedChangeFileTimerId);
        // run this code in a few milliseconds if another hasn't come in behind it
        queuedChangeFileTimerId = setTimeout(function () {
            // figure out what actually needs to be rebuilt
            var buildData = runBuildUpdate(context, queuedChangedFiles);
            // clear out all the files that are queued up for the build update
            queuedChangedFiles.length = 0;
            if (buildData) {
                // cool, we've got some build updating to do ;)
                buildTask.buildUpdate(buildData.event, buildData.filePath, context);
            }
        }, BUILD_UPDATE_DEBOUNCE_MS);
    }
    return Promise.resolve();
}
exports.buildUpdate = buildUpdate;
function runBuildUpdate(context, changedFiles) {
    if (!changedFiles || !changedFiles.length) {
        return null;
    }
    // create the data which will be returned
    var data = {
        event: changedFiles.map(function (f) { return f.event; }).find(function (ev) { return ev !== 'change'; }) || 'change',
        filePath: changedFiles[0].filePath,
        changedFiles: changedFiles.map(function (f) { return f.filePath; })
    };
    var tsFiles = changedFiles.filter(function (f) { return f.ext === '.ts'; });
    if (tsFiles.length > 1) {
        // multiple .ts file changes
        // if there is more than one ts file changing then
        // let's just do a full transpile build
        context.transpileState = interfaces_1.BuildState.RequiresBuild;
    }
    else if (tsFiles.length) {
        // only one .ts file changed
        if (transpile_1.canRunTranspileUpdate(tsFiles[0].event, tsFiles[0].filePath, context)) {
            // .ts file has only changed, it wasn't a file add/delete
            // we can do the quick typescript update on this changed file
            context.transpileState = interfaces_1.BuildState.RequiresUpdate;
        }
        else {
            // .ts file was added or deleted, we need a full rebuild
            context.transpileState = interfaces_1.BuildState.RequiresBuild;
        }
    }
    var sassFiles = changedFiles.filter(function (f) { return f.ext === '.scss'; });
    if (sassFiles.length) {
        // .scss file was changed/added/deleted, lets do a sass update
        context.sassState = interfaces_1.BuildState.RequiresUpdate;
    }
    var sassFilesNotChanges = changedFiles.filter(function (f) { return f.ext === '.ts' && f.event !== 'change'; });
    if (sassFilesNotChanges.length) {
        // .ts file was either added or deleted, so we'll have to
        // run sass again to add/remove that .ts file's potential .scss file
        context.sassState = interfaces_1.BuildState.RequiresUpdate;
    }
    var htmlFiles = changedFiles.filter(function (f) { return f.ext === '.html'; });
    if (htmlFiles.length) {
        if (context.bundleState === interfaces_1.BuildState.SuccessfulBuild && htmlFiles.every(function (f) { return f.event === 'change'; })) {
            // .html file was changed
            // just doing a template update is fine
            context.templateState = interfaces_1.BuildState.RequiresUpdate;
        }
        else {
            // .html file was added/deleted
            // we should do a full transpile build because of this
            context.transpileState = interfaces_1.BuildState.RequiresBuild;
        }
    }
    if (context.transpileState === interfaces_1.BuildState.RequiresUpdate || context.transpileState === interfaces_1.BuildState.RequiresBuild) {
        if (context.bundleState === interfaces_1.BuildState.SuccessfulBuild || context.bundleState === interfaces_1.BuildState.RequiresUpdate) {
            // transpiling needs to happen
            // and there has already been a successful bundle before
            // so let's just do a bundle update
            context.bundleState = interfaces_1.BuildState.RequiresUpdate;
        }
        else {
            // transpiling needs to happen
            // but we've never successfully bundled before
            // so let's do a full bundle build
            context.bundleState = interfaces_1.BuildState.RequiresBuild;
        }
    }
    // guess which file is probably the most important here
    data.filePath = tsFiles.concat(sassFiles, htmlFiles)[0].filePath;
    return data;
}
exports.runBuildUpdate = runBuildUpdate;
var taskInfo = {
    fullArg: '--watch',
    shortArg: '-w',
    envVar: 'IONIC_WATCH',
    packageConfig: 'ionic_watch',
    defaultConfigFile: 'watch.config'
};
var watchCount = 0;
var BUILD_UPDATE_DEBOUNCE_MS = 20;
