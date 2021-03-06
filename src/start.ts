import { config as loadEnvironmentVariables } from 'dotenv';
import { Router } from 'express';
import { basename } from 'path';
import { getConfig, resolveApiModulePath } from './common';
import { lambdaAsExpressHandler, runServer } from './express';

/**
 * Start a local server for the lambda apis registered in the config file.
 * Running in this mode the apis are loaded once and not updated with changes.
 * @param {string} configFile
 * @param {number} port
 * @returns {Promise<void>}
 */
export async function start({configFile, port}: {configFile: string, port: number}) {
  loadEnvironmentVariables();
  const config = await getConfig(configFile);
  const routes = await Promise.all(config.apis.map(async api => {
    const handler = (await import(resolveApiModulePath(api))).handler;
    return Router().all(`${config.basePath}/${basename(api)}(/*)?`, lambdaAsExpressHandler(handler));
  }));
  runServer(routes, port);
}
