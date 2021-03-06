"use strict";
var path_1 = require('path');
var logger_1 = require('./util/logger');
var config_1 = require('./util/config');
var helpers_1 = require('./util/helpers');
var worker_client_1 = require('./worker-client');
var cleanCss = require('clean-css');
function cleancss(context, configFile) {
    context = config_1.generateContext(context);
    configFile = config_1.getUserConfigFile(context, taskInfo, configFile);
    var logger = new logger_1.Logger('cleancss');
    return worker_client_1.runWorker('cleancss', 'cleancssWorker', context, configFile)
        .then(function () {
        logger.finish();
    })
        .catch(function (err) {
        throw logger.fail(err);
    });
}
exports.cleancss = cleancss;
function cleancssWorker(context, configFile) {
    return new Promise(function (resolve, reject) {
        var cleanCssConfig = config_1.fillConfigDefaults(configFile, taskInfo.defaultConfigFile);
        var srcFile = path_1.join(context.buildDir, cleanCssConfig.sourceFileName);
        var destFile = path_1.join(context.buildDir, cleanCssConfig.destFileName);
        logger_1.Logger.debug("cleancss read: " + srcFile);
        helpers_1.readFileAsync(srcFile).then(function (fileContent) {
            var minifier = new cleanCss(cleanCssConfig);
            minifier.minify(fileContent, function (err, minified) {
                if (err) {
                    reject(new logger_1.BuildError(err));
                }
                else if (minified.errors && minified.errors.length > 0) {
                    // just return the first error for now I guess
                    minified.errors.forEach(function (e) {
                        logger_1.Logger.error(e);
                    });
                    reject(new logger_1.BuildError());
                }
                else {
                    logger_1.Logger.debug("cleancss write: " + destFile);
                    helpers_1.writeFileAsync(destFile, minified.styles).then(function () {
                        resolve();
                    });
                }
            });
        });
    });
}
exports.cleancssWorker = cleancssWorker;
var taskInfo = {
    fullArg: '--cleancss',
    shortArg: '-e',
    envVar: 'IONIC_CLEANCSS',
    packageConfig: 'ionic_cleancss',
    defaultConfigFile: 'cleancss.config'
};
