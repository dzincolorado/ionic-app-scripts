"use strict";
var interfaces_1 = require('./util/interfaces');
var logger_1 = require('./util/logger');
var helpers_1 = require('./util/helpers');
var events_1 = require('./util/events');
var config_1 = require('./util/config');
var path_1 = require('path');
var webpackApi = require('webpack');
var events_2 = require('events');
var eventEmitter = new events_2.EventEmitter();
var INCREMENTAL_BUILD_FAILED = 'incremental_build_failed';
var INCREMENTAL_BUILD_SUCCESS = 'incremental_build_success';
/*
 * Due to how webpack watch works, sometimes we start an update event
 * but it doesn't affect the bundle at all, for example adding a new typescript file
 * not imported anywhere or adding an html file not used anywhere.
 * In this case, we'll be left hanging and have screwed up logging when the bundle is modified
 * because multiple promises will resolve at the same time (we queue up promises waiting for an event to occur)
 * To mitigate this, store pending "webpack watch"/bundle update promises in this array and only resolve the
 * the most recent one. reject all others at that time with an IgnorableError.
 */
var pendingPromises = [];
function webpack(context, configFile) {
    context = config_1.generateContext(context);
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    logger_1.Logger.debug('Webpack: Setting Context on shared singleton');
    helpers_1.setContext(context);
    var logger = new logger_1.Logger('webpack');
    return webpackWorker(context, configFile)
        .then(function () {
        context.bundleState = interfaces_1.BuildState.SuccessfulBuild;
        logger.finish();
    })
        .catch(function (err) {
        context.bundleState = interfaces_1.BuildState.RequiresBuild;
        throw logger.fail(err);
    });
}
exports.webpack = webpack;
function webpackUpdate(event, path, context, configFile) {
    var logger = new logger_1.Logger('webpack update');
    var extension = path_1.extname(path);
    var webpackConfig = getWebpackConfig(context, configFile);
    return Promise.resolve().then(function () {
        if (extension === '.ts') {
            logger_1.Logger.debug('webpackUpdate: Typescript File Changed');
            return typescriptFileChanged(path, context.fileCache);
        }
        else {
            logger_1.Logger.debug('webpackUpdate: Non-Typescript File Changed');
            return otherFileChanged(path).then(function (file) {
                return [file];
            });
        }
    })
        .then(function (files) {
        logger_1.Logger.debug('webpackUpdate: Starting Incremental Build');
        var promisetoReturn = runWebpackIncrementalBuild(false, context, webpackConfig);
        events_1.emit(events_1.EventType.WebpackFilesChanged, [path]);
        return promisetoReturn;
    }).then(function (stats) {
        // the webpack incremental build finished, so reset the list of pending promises
        pendingPromises = [];
        logger_1.Logger.debug('webpackUpdate: Incremental Build Done, processing Data');
        return webpackBuildComplete(stats, context, webpackConfig);
    }).then(function () {
        context.bundleState = interfaces_1.BuildState.SuccessfulBuild;
        return logger.finish();
    }).catch(function (err) {
        context.bundleState = interfaces_1.BuildState.RequiresBuild;
        if (err instanceof logger_1.IgnorableError) {
            throw err;
        }
        throw logger.fail(err);
    });
}
exports.webpackUpdate = webpackUpdate;
function webpackWorker(context, configFile) {
    var webpackConfig = getWebpackConfig(context, configFile);
    var promise = null;
    if (context.isWatch) {
        promise = runWebpackIncrementalBuild(!context.webpackWatch, context, webpackConfig);
    }
    else {
        promise = runWebpackFullBuild(webpackConfig);
    }
    return promise
        .then(function (stats) {
        return webpackBuildComplete(stats, context, webpackConfig);
    });
}
exports.webpackWorker = webpackWorker;
function webpackBuildComplete(stats, context, webpackConfig) {
    // set the module files used in this bundle
    // this reference can be used elsewhere in the build (sass)
    var files = stats.compilation.modules.map(function (webpackObj) {
        if (webpackObj.resource) {
            return webpackObj.resource;
        }
        else {
            return webpackObj.context;
        }
    }).filter(function (path) {
        // just make sure the path is not null
        return path && path.length > 0;
    });
    context.moduleFiles = files;
    return Promise.resolve();
}
function runWebpackFullBuild(config) {
    return new Promise(function (resolve, reject) {
        var callback = function (err, stats) {
            if (err) {
                reject(new logger_1.BuildError(err));
            }
            else {
                resolve(stats);
            }
        };
        var compiler = webpackApi(config);
        compiler.run(callback);
    });
}
function runWebpackIncrementalBuild(initializeWatch, context, config) {
    var promise = new Promise(function (resolve, reject) {
        // start listening for events, remove listeners once an event is received
        eventEmitter.on(INCREMENTAL_BUILD_FAILED, function (err) {
            logger_1.Logger.debug('Webpack Bundle Update Failed');
            eventEmitter.removeAllListeners();
            handleWebpackBuildFailure(resolve, reject, err, promise, pendingPromises);
        });
        eventEmitter.on(INCREMENTAL_BUILD_SUCCESS, function (stats) {
            logger_1.Logger.debug('Webpack Bundle Updated');
            eventEmitter.removeAllListeners();
            handleWebpackBuildSuccess(resolve, reject, stats, promise, pendingPromises);
        });
        if (initializeWatch) {
            startWebpackWatch(context, config);
        }
    });
    pendingPromises.push(promise);
    return promise;
}
function handleWebpackBuildFailure(resolve, reject, error, promise, pendingPromises) {
    // check if the promise if the last promise in the list of pending promises
    if (pendingPromises.length > 0 && pendingPromises[pendingPromises.length - 1] === promise) {
        // reject this one with a build error
        reject(new logger_1.BuildError(error));
        return;
    }
    // for all others, reject with an ignorable error
    reject(new logger_1.IgnorableError());
}
function handleWebpackBuildSuccess(resolve, reject, stats, promise, pendingPromises) {
    // check if the promise if the last promise in the list of pending promises
    if (pendingPromises.length > 0 && pendingPromises[pendingPromises.length - 1] === promise) {
        logger_1.Logger.debug('handleWebpackBuildSuccess: Resolving with Webpack data');
        resolve(stats);
        return;
    }
    // for all others, reject with an ignorable error
    logger_1.Logger.debug('handleWebpackBuildSuccess: Rejecting with ignorable error');
    reject(new logger_1.IgnorableError());
}
function startWebpackWatch(context, config) {
    logger_1.Logger.debug('Starting Webpack watch');
    var compiler = webpackApi(config);
    context.webpackWatch = compiler.watch({}, function (err, stats) {
        if (err) {
            eventEmitter.emit(INCREMENTAL_BUILD_FAILED, err);
        }
        else {
            eventEmitter.emit(INCREMENTAL_BUILD_SUCCESS, stats);
        }
    });
}
function getWebpackConfig(context, configFile) {
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    var webpackConfig = config_1.fillConfigDefaults(configFile, taskInfo.defaultConfigFile);
    webpackConfig.entry = config_1.replacePathVars(context, webpackConfig.entry);
    webpackConfig.output.path = config_1.replacePathVars(context, webpackConfig.output.path);
    return webpackConfig;
}
exports.getWebpackConfig = getWebpackConfig;
function getOutputDest(context, webpackConfig) {
    return path_1.join(webpackConfig.output.path, webpackConfig.output.filename);
}
exports.getOutputDest = getOutputDest;
function typescriptFileChanged(fileChangedPath, fileCache) {
    // convert to the .js file because those are the transpiled files in memory
    var jsFilePath = helpers_1.changeExtension(fileChangedPath, '.js');
    var sourceFile = fileCache.get(jsFilePath);
    var mapFile = fileCache.get(jsFilePath + '.map');
    return [sourceFile, mapFile];
}
function otherFileChanged(fileChangedPath) {
    return helpers_1.readFileAsync(fileChangedPath).then(function (content) {
        return { path: fileChangedPath, content: content };
    });
}
var taskInfo = {
    fullArg: '--webpack',
    shortArg: '-w',
    envVar: 'IONIC_WEBPACK',
    packageConfig: 'ionic_webpack',
    defaultConfigFile: 'webpack.config'
};
