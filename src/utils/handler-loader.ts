import { resolve, extname, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { build } from 'esbuild';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

export class HandlerLoader {
  private cache = new Map<string, unknown>();
  private tempDir: string;

  constructor() {
    this.tempDir = join(tmpdir(), '@ori-sh/dev-tools', Date.now().toString());
    mkdirSync(this.tempDir, { recursive: true });
  }

  async loadHandler(handlerPath: string, workingDir: string): Promise<unknown> {
    const cacheKey = `${workingDir}:${handlerPath}`;

    // Clear cache for hot reload
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    }

    // Resolve the handler file path
    const [filePath, exportName = 'handler'] = handlerPath.split('.');
    const resolvedPath = this.resolveHandlerFile(filePath, workingDir);

    if (!resolvedPath) {
      throw new Error(`Handler file not found: ${filePath}`);
    }

    // Build the handler file if it's TypeScript
    const builtPath = await this.buildHandler(resolvedPath);

    // Load the handler function
    const handler = await this.importHandler(builtPath, exportName);

    this.cache.set(cacheKey, handler);
    return handler;
  }

  private resolveHandlerFile(filePath: string, workingDir: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

    for (const ext of extensions) {
      const fullPath = resolve(workingDir, filePath + ext);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Try without extension
    const fullPath = resolve(workingDir, filePath);
    if (existsSync(fullPath)) {
      return fullPath;
    }

    return null;
  }

  private async buildHandler(handlerPath: string): Promise<string> {
    const ext = extname(handlerPath);

    // If it's already JavaScript, return as-is
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs') {
      return handlerPath;
    }

    // Build TypeScript to JavaScript
    const outputPath = join(this.tempDir, `${Date.now()}.js`);

    // Get external dependencies to exclude from bundling
    const externalDeps = this.getExternalDependencies(handlerPath);

    await build({
      entryPoints: [handlerPath],
      bundle: true, // Enable bundling to resolve relative imports
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: outputPath,
      allowOverwrite: true,
      external: externalDeps, // Exclude native and node_modules dependencies
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.jsx': 'jsx',
      },
      // Resolve from the handler's directory context
      absWorkingDir: dirname(handlerPath),
    });

    return outputPath;
  }

  private getExternalDependencies(handlerPath: string): string[] {
    const external: string[] = [];

    // Find the nearest package.json to get dependencies
    const packageJsonPath = this.findPackageJson(dirname(handlerPath));
    if (packageJsonPath) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
          ...packageJson.peerDependencies,
        };

        // Add all node_modules dependencies as external
        // This prevents bundling of native modules and keeps them in node_modules
        external.push(...Object.keys(allDeps));
      } catch {
        // If we can't read package.json, use common native modules
        console.warn('Could not read package.json, using fallback external list');
      }
    }

    // Add common native modules that should never be bundled
    const nativeModules = [
      'argon2',
      'bcrypt',
      'sharp',
      'sqlite3',
      'node-gyp',
      'canvas',
      'playwright',
      'puppeteer',
      'fsevents',
      'chokidar',
    ];

    external.push(...nativeModules);

    // Remove duplicates
    return [...new Set(external)];
  }

  private findPackageJson(startDir: string): string | null {
    let currentDir = startDir;
    const root = resolve('/');

    while (currentDir !== root) {
      const packageJsonPath = join(currentDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        return packageJsonPath;
      }
      currentDir = dirname(currentDir);
    }

    return null;
  }

  private async importHandler(builtPath: string, exportName: string): Promise<unknown> {
    try {
      // Import the module using dynamic import for ESM compatibility
      const moduleUrl = `file://${builtPath}?t=${Date.now()}`;
      const module = await import(moduleUrl);

      // Get the export
      let handler = module[exportName];
      let actualExportName = exportName;

      if (!handler) {
        handler = module.default;
        actualExportName = 'default';
      }

      if (!handler) {
        handler = module;
        actualExportName = 'module';
      }

      if (typeof handler !== 'function') {
        throw new Error(`Export '${actualExportName}' is not a function in ${builtPath}`);
      }

      return handler;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to import handler: ${error.message}`);
      }
      throw error;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.clearCache();

    // Clean up temp directory
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
