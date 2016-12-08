import { BuildContext } from './util/interfaces';
export declare function sass(context?: BuildContext, configFile?: string): Promise<string>;
export declare function sassUpdate(event: string, filePath: string, context: BuildContext): Promise<string>;
export declare function sassWorker(context: BuildContext, configFile: string): Promise<string>;
export interface SassConfig {
    outputFilename?: string;
    outFile?: string;
    file?: string;
    data?: string;
    includePaths?: string[];
    excludeModules?: string[];
    includeFiles?: RegExp[];
    excludeFiles?: RegExp[];
    directoryMaps?: {
        [key: string]: string;
    };
    sortComponentPathsFn?: (a: any, b: any) => number;
    sortComponentFilesFn?: (a: any, b: any) => number;
    variableSassFiles?: string[];
    autoprefixer?: any;
    sourceMap?: string;
    omitSourceMapUrl?: boolean;
    sourceMapContents?: boolean;
}
export interface SassMap {
    file: string;
    sources: any[];
}
