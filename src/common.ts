import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { z } from 'zod';
import { configFileSchema } from './schemas';

export function resolveApiPath(api: string) {
  return resolve(api);
}

export function resolveApiModulePath(api: string) {
  return join(resolveApiPath(api), 'index.ts');
}


async function loadConfigFile(configFile: string): Promise<z.infer<typeof configFileSchema>> {
  const configFilePath = isAbsolute(configFile) ? configFile : resolve(configFile);
  try {
    const configFileContent = await readFile(configFilePath, 'utf-8');
    const configObject = JSON.parse(configFileContent);
    return configFileSchema.parse(configObject);
  } catch (e) {
    console.error(`Failed reading config file from ${configFilePath}`);
    throw e;
  }
}

export async function getConfig(configFile = 'local-lambda-server.json') {
  const config = await loadConfigFile(configFile);
  if ((await Promise.all(config.apis.map(async api => {
    const apiModulePath = resolveApiModulePath(api);
    return (await stat(apiModulePath)).isFile() || (console.log(`Missing index.ts at ${apiModulePath}`), false);
  }))).includes(false)) {
    throw Error('Failed validating apis entry in your config file.');
  }
  return config;
}

export function rethrow(error: any): void {
  throw error
}

export async function saveZipFile(files: Array<{content: Buffer, name: string, mode: number}>, dist: string) {
  const zip = archiver('zip', {zlib: {level: 9}});
  zip.on('error', rethrow);
  zip.on('warning', console.log);
  zip.pipe(createWriteStream(dist));
  files.forEach(({ content, name, mode }) => zip.append(content, { name, mode }))
  await zip.finalize();
}
