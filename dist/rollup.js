"use strict";
var interfaces_1 = require('./util/interfaces');
var logger_1 = require('./util/logger');
var config_1 = require('./util/config');
var ion_compiler_1 = require('./plugins/ion-compiler');
var path_1 = require('path');
var rollupBundler = require('rollup');
function rollup(context, configFile) {
    context = config_1.generateContext(context);
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    var logger = new logger_1.Logger('rollup');
    return rollupWorker(context, configFile)
        .then(function () {
        context.bundleState = interfaces_1.BuildState.SuccessfulBuild;
        logger.finish();
    })
        .catch(function (err) {
        context.bundleState = interfaces_1.BuildState.RequiresBuild;
        throw logger.fail(err);
    });
}
exports.rollup = rollup;
function rollupUpdate(event, filePath, context) {
    var logger = new logger_1.Logger('rollup update');
    var configFile = config_1.getUserConfigFile(context, taskInfo, null);
    return rollupWorker(context, configFile)
        .then(function () {
        context.bundleState = interfaces_1.BuildState.SuccessfulBuild;
        logger.finish();
    })
        .catch(function (err) {
        context.bundleState = interfaces_1.BuildState.RequiresBuild;
        throw logger.fail(err);
    });
}
exports.rollupUpdate = rollupUpdate;
function rollupWorker(context, configFile) {
    return new Promise(function (resolve, reject) {
        var rollupConfig = getRollupConfig(context, configFile);
        rollupConfig.dest = getOutputDest(context, rollupConfig);
        // replace any path vars like {{TMP}} with the real path
        rollupConfig.entry = config_1.replacePathVars(context, path_1.normalize(rollupConfig.entry));
        rollupConfig.dest = config_1.replacePathVars(context, path_1.normalize(rollupConfig.dest));
        if (!context.isProd) {
            // ngc does full production builds itself and the bundler
            // will already have receive transpiled and AoT templates
            // dev mode auto-adds the ion-compiler plugin, which will inline
            // templates and transpile source typescript code to JS before bundling
            rollupConfig.plugins.unshift(ion_compiler_1.ionCompiler(context));
        }
        // tell rollup to use a previous bundle as its starting point
        rollupConfig.cache = cachedBundle;
        if (!rollupConfig.onwarn) {
            // use our own logger if one wasn't already provided
            rollupConfig.onwarn = createOnWarnFn();
        }
        logger_1.Logger.debug("entry: " + rollupConfig.entry + ", dest: " + rollupConfig.dest + ", cache: " + rollupConfig.cache + ", format: " + rollupConfig.format);
        checkDeprecations(context, rollupConfig);
        // bundle the app then create create css
        rollupBundler.rollup(rollupConfig)
            .then(function (bundle) {
            logger_1.Logger.debug("bundle.modules: " + bundle.modules.length);
            // set the module files used in this bundle
            // this reference can be used elsewhere in the build (sass)
            context.moduleFiles = bundle.modules.map(function (m) { return m.id; });
            // cache our bundle for later use
            if (context.isWatch) {
                cachedBundle = bundle;
            }
            // write the bundle
            return bundle.write(rollupConfig);
        })
            .then(function () {
            // clean up any references (overkill yes, but let's play it safe)
            rollupConfig = rollupConfig.cache = rollupConfig.onwarn = rollupConfig.plugins = null;
            resolve();
        })
            .catch(function (err) {
            // ensure references are cleared up when there's an error
            cachedBundle = rollupConfig = rollupConfig.cache = rollupConfig.onwarn = rollupConfig.plugins = null;
            reject(new logger_1.BuildError(err));
        });
    });
}
exports.rollupWorker = rollupWorker;
function getRollupConfig(context, configFile) {
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    return config_1.fillConfigDefaults(configFile, taskInfo.defaultConfigFile);
}
exports.getRollupConfig = getRollupConfig;
function getOutputDest(context, rollupConfig) {
    if (!path_1.isAbsolute(rollupConfig.dest)) {
        // user can pass in absolute paths
        // otherwise save it in the build directory
        return path_1.join(context.buildDir, rollupConfig.dest);
    }
    return rollupConfig.dest;
}
exports.getOutputDest = getOutputDest;
function checkDeprecations(context, rollupConfig) {
    if (!context.isProd) {
        if (rollupConfig.entry.indexOf('.tmp') > -1 || rollupConfig.entry.endsWith('.js')) {
            // warning added 2016-10-05, v0.0.29
            throw new logger_1.BuildError('\nDev builds no longer use the ".tmp" directory. Please update your rollup config\'s\n' +
                'entry to use your "src" directory\'s "main.dev.ts" TypeScript file.\n' +
                'For example, the entry for dev builds should be: "src/app/main.dev.ts"');
        }
    }
}
var cachedBundle = null;
function createOnWarnFn() {
    var previousWarns = {};
    return function onWarningMessage(msg) {
        if (msg in previousWarns) {
            return;
        }
        previousWarns[msg] = true;
        if (!(IGNORE_WARNS.some(function (warnIgnore) { return msg.indexOf(warnIgnore) > -1; }))) {
            logger_1.Logger.warn("rollup: " + msg);
        }
    };
}
var IGNORE_WARNS = [
    'keyword is equivalent to'
];
var taskInfo = {
    fullArg: '--rollup',
    shortArg: '-r',
    envVar: 'IONIC_ROLLUP',
    packageConfig: 'ionic_rollup',
    defaultConfigFile: 'rollup.config'
};
