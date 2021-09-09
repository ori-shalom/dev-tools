import { getConfig, resolveApiModulePath, resolveApiPath, saveZipFile } from './common';
import { join, resolve, basename } from 'path';
import { copyFile } from 'fs/promises';

/**
 * Package all TypeScript Lambda Function APIs as ready to deploy ZIP files.
 * This includes:
 * - Transpiling TypeScript to JavaScript
 * - Minifying output
 * - Tree shaking to ship only relevant app code
 * - source-map
 * - Additional binary assets
 * @param {string} configFile
 * @returns {Promise<void>}
 * @param dist
 */
export async function packageLambda({configFile, dist}: {configFile: string, dist?: string}) {
  const config = await getConfig(configFile);
  await Promise.all(config.apis.map(async api => {
    const { code, map, assets } = await require('@vercel/ncc')(resolveApiModulePath(api), {
      cache: false,
      minify: true,
      sourceMap: true,
      assetBuilds: true,
      externals: ['aws-sdk'] // Included in AWS Lambda
    });
    const apiName = basename(api);
    const zipPath = join(dist ? resolve(dist) : resolveApiPath(api), `${apiName}.zip`);
    await saveZipFile([
      { content: code, name: 'index.js', mode: 444 },
      { content: map, name: 'index.js.map', mode: 444 },
      ...Object.entries(assets as object).map(([name, {source, permissions}]) => ({
        content: source, name, mode: permissions
      }))
    ], zipPath);
  }));
}
