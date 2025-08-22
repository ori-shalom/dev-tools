import { resolve, extname, dirname } from 'path';
import { existsSync } from 'fs';
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

    await build({
      entryPoints: [handlerPath],
      bundle: true, // Enable bundling to resolve relative imports
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: outputPath,
      allowOverwrite: true,
      external: [], // Bundle all dependencies for development
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
