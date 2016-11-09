import { join } from 'path';
import { BuildContext, TaskInfo } from './util/interfaces';
import { BuildError, Logger } from './util/logger';
import { fillConfigDefaults, generateContext, getUserConfigFile } from './util/config';
import { readFileAsync, writeFileAsync } from './util/helpers';
import { runWorker } from './worker-client';
import * as cleanCss from 'clean-css';


export function cleancss(context?: BuildContext, configFile?: string) {
  context = generateContext(context);
  configFile = getUserConfigFile(context, taskInfo, configFile);

  const logger = new Logger('cleancss');

  return runWorker('cleancss', 'cleancssWorker', context, configFile)
    .then(() => {
      logger.finish();
    })
    .catch(err => {
      throw logger.fail(err);
    });
}


export function cleancssWorker(context: BuildContext, configFile: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const cleanCssConfig: CleanCssConfig = fillConfigDefaults(configFile, taskInfo.defaultConfigFile);
    const srcFile = join(context.buildDir, cleanCssConfig.sourceFileName);
    const destFile = join(context.buildDir, cleanCssConfig.destFileName);

    Logger.debug(`cleancss read: ${srcFile}`);

    readFileAsync(srcFile).then(fileContent => {
      const minifier = new cleanCss(cleanCssConfig);
      minifier.minify(fileContent, (err, minified) => {
        if (err) {
          reject(new BuildError(err));

        } else if (minified.errors && minified.errors.length > 0) {
          // just return the first error for now I guess
          minified.errors.forEach(e => {
            Logger.error(e);
          });
          reject(new BuildError());

        } else {
          Logger.debug(`cleancss write: ${destFile}`);
          writeFileAsync(destFile, minified.styles).then(() => {
            resolve();
          });
        }
      });
    });

  });
}


const taskInfo: TaskInfo = {
  fullArg: '--cleancss',
  shortArg: '-e',
  envVar: 'IONIC_CLEANCSS',
  packageConfig: 'ionic_cleancss',
  defaultConfigFile: 'cleancss.config'
};


export interface CleanCssConfig {
  // https://www.npmjs.com/package/clean-css
  sourceFileName: string;
  // sourceSourceMapName: string;
  destFileName: string;
  // destSourceMapName: string;

  processImport:string;
  processImportFrom: string[];
}
