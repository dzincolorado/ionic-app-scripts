"use strict";
var Logger_1 = require('../util/Logger');
var hybrid_file_system_1 = require('./hybrid-file-system');
var watch_memory_system_1 = require('./watch-memory-system');
var IonicEnvironmentPlugin = (function () {
    function IonicEnvironmentPlugin(fileCache) {
        this.fileCache = fileCache;
    }
    IonicEnvironmentPlugin.prototype.apply = function (compiler) {
        var _this = this;
        compiler.plugin('environment', function (otherCompiler, callback) {
            Logger_1.Logger.debug('[IonicEnvironmentPlugin] apply: creating environment plugin');
            var hybridFileSystem = new hybrid_file_system_1.HybridFileSystem(_this.fileCache, compiler.inputFileSystem);
            compiler.inputFileSystem = hybridFileSystem;
            compiler.resolvers.normal.fileSystem = compiler.inputFileSystem;
            compiler.resolvers.context.fileSystem = compiler.inputFileSystem;
            compiler.resolvers.loader.fileSystem = compiler.inputFileSystem;
            // TODO - we can set-up the output file system here for in-memory serving
            compiler.watchFileSystem = new watch_memory_system_1.WatchMemorySystem(_this.fileCache);
        });
    };
    return IonicEnvironmentPlugin;
}());
exports.IonicEnvironmentPlugin = IonicEnvironmentPlugin;
