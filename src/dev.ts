import chokidar from 'chokidar';
import { Router } from 'express';
import { resolve, join, basename } from 'path';
import { getConfig, resolveApiPath } from './common';
import { lambdaAsExpressHandler, runServer } from './express';


/**
 * Returns a Map of handlers for each API and listen to file system changes to reload and recompile the handlers.
 * @param {Array<string>} apis
 * @returns {Map<string, Promise<any>>}
 */
function watchedHandlers(apis: Array<string>) {
  const apiPaths = apis.map(resolveApiPath);
  const handlers = new Map<string, Promise<any>>(apiPaths.map(apiPath =>
    [apiPath, import(join(apiPath, 'index.ts')).then(module => module.handler)]));
  chokidar.watch(apiPaths, {ignoreInitial: true}).on('all', (event, path) => {
    const changedApi = apiPaths.find(apiPath => path.startsWith(apiPath));
    if (changedApi) {
      const apiModule = resolve(changedApi, 'index.ts');
      delete require.cache[require.resolve(apiModule)]; // invalidate require cache to reload the latest handler
      handlers.set(changedApi, import(apiModule).then(module => module.handler));
    }
  });
  return handlers;
}

/**
 * Start a local dev server for the lambda apis registered in the config file.
 * Running in this mode the apis are reloaded with every request making it a bit slower but allow editing getting a fast
 * feedback during development.
 * @param {string} configFile
 * @param {number} port
 * @returns {Promise<void>}
 */
export async function dev({configFile, port}: {configFile: string, port: number}) {
  const config = await getConfig(configFile);
  const handlers = watchedHandlers(config.apis);
  const routes = await Promise.all(config.apis.map(async api =>
    Router().all(`${config.basePath}/${basename(api)}(/*)?`, async (...args) => {
      const expressHandler = lambdaAsExpressHandler(await handlers.get(resolveApiPath(api)));
      expressHandler(...args);
    })
  ));
  runServer(routes, port);
}
