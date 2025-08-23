import { resolve, extname, dirname } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { build, Plugin, PluginBuild, OnResolveArgs } from 'esbuild';
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

    // Create custom plugin to resolve workspace packages
    const workspacePlugin = this.createWorkspaceResolverPlugin(handlerPath);

    await build({
      entryPoints: [handlerPath],
      bundle: true, // Enable bundling to resolve relative imports
      platform: 'node',
      target: 'node22',
      format: 'esm',
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
      // Handle workspace packages and TypeScript resolution
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'],
      mainFields: ['main', 'module', 'exports'],
      conditions: ['node', 'import', 'require'],
      plugins: [workspacePlugin],
    });

    return outputPath;
  }

  private createWorkspaceResolverPlugin(handlerPath: string): Plugin {
    const packageJsonPath = this.findPackageJson(dirname(handlerPath));
    if (!packageJsonPath) {
      return { name: 'workspace-resolver', setup: () => {} };
    }

    const workspacePackages = this.getWorkspacePackages(packageJsonPath);
    const workspaceRoot = dirname(packageJsonPath);

    return {
      name: 'workspace-resolver',
      setup: (build: PluginBuild) => {
        // Resolve workspace packages to their actual file paths
        build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
          if (workspacePackages.includes(args.path)) {
            const resolvedPath = this.resolveWorkspacePath(args.path, workspaceRoot);
            if (resolvedPath) {
              return {
                path: resolvedPath,
                // Force bundling of workspace packages
                external: false,
              };
            }
          }
          // Let other resolvers handle non-workspace imports
          return undefined;
        });
      },
    };
  }

  private resolveWorkspacePath(packageName: string, workspaceRoot: string): string | null {
    // Try to find the workspace package using the same logic as isPackageInWorkspace
    const possiblePaths = [
      // Standard patterns
      join(workspaceRoot, 'packages', packageName.replace(/^@[^/]+\//, '')), // @scope/name -> name
      join(workspaceRoot, 'packages', packageName), // direct name
      join(workspaceRoot, 'libs', packageName.replace(/^@[^/]+\//, '')),
      join(workspaceRoot, 'libs', packageName),
      join(workspaceRoot, 'apps', packageName.replace(/^@[^/]+\//, '')),
      join(workspaceRoot, 'apps', packageName),
      // Handle shared specifically for @botwork/shared -> packages/shared
      join(workspaceRoot, 'packages', 'shared'),
    ];

    for (const basePath of possiblePaths) {
      if (existsSync(basePath)) {
        const packageJsonPath = join(basePath, 'package.json');
        if (existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

            // Verify this is the correct package
            if (packageJson.name === packageName) {
              // Get the main entry point
              const mainField = packageJson.main || packageJson.module || packageJson.exports?.main || './src/index.ts';
              const fullPath = resolve(basePath, mainField);

              // Try different extensions if the exact path doesn't exist
              if (existsSync(fullPath)) {
                return fullPath;
              }

              // Try with common extensions
              const extensions = ['.ts', '.js', '.tsx', '.jsx', '.mts', '.mjs'];
              for (const ext of extensions) {
                const pathWithExt = fullPath.replace(/\.[^.]*$/, ext);
                if (existsSync(pathWithExt)) {
                  return pathWithExt;
                }
              }

              // Try index files in the directory
              const dir = dirname(fullPath);
              for (const ext of extensions) {
                const indexPath = join(dir, `index${ext}`);
                if (existsSync(indexPath)) {
                  return indexPath;
                }
              }

              // If main field points to a directory, try index files there
              if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
                for (const ext of extensions) {
                  const indexPath = join(fullPath, `index${ext}`);
                  if (existsSync(indexPath)) {
                    return indexPath;
                  }
                }
              }
            }
          } catch {
            // Invalid package.json, continue
          }
        }
      }
    }

    return null;
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

        // Get workspace packages - these will be BUNDLED, not external
        const workspacePackages = this.getWorkspacePackages(packageJsonPath);

        // Add non-workspace dependencies as external
        // IMPORTANT: Workspace packages are NOT added to external list
        // This allows ESBuild to bundle them, resolving TypeScript imports
        Object.keys(allDeps).forEach((dep) => {
          if (!workspacePackages.includes(dep)) {
            external.push(dep);
          }
        });
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

  private getWorkspacePackages(packageJsonPath: string): string[] {
    const workspacePackages: string[] = [];

    try {
      // Check if this is a workspace (has workspaces field)
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const workspaceRoot = dirname(packageJsonPath);

      // Get all dependencies
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };

      // Check for pnpm workspace
      const pnpmWorkspacePath = join(workspaceRoot, 'pnpm-workspace.yaml');
      if (existsSync(pnpmWorkspacePath)) {
        Object.keys(deps).forEach((dep) => {
          // pnpm workspace patterns
          if (deps[dep].startsWith('workspace:') || this.isPackageInWorkspace(dep, workspaceRoot)) {
            workspacePackages.push(dep);
          }
        });
      }

      // Check for npm/yarn workspaces
      if (packageJson.workspaces) {
        Object.keys(deps).forEach((dep) => {
          // npm/yarn workspace patterns
          if (
            deps[dep] === '*' ||
            deps[dep].startsWith('workspace:') ||
            this.isPackageInWorkspace(dep, workspaceRoot)
          ) {
            workspacePackages.push(dep);
          }
        });
      }

      // Fallback: check if packages physically exist in workspace
      if (workspacePackages.length === 0) {
        Object.keys(deps).forEach((dep) => {
          if (this.isPackageInWorkspace(dep, workspaceRoot)) {
            workspacePackages.push(dep);
          }
        });
      }
    } catch {
      // Error detecting workspace packages, continue with empty list
    }

    return workspacePackages;
  }

  private isPackageInWorkspace(packageName: string, workspaceRoot: string): boolean {
    const possiblePaths = [
      // Standard patterns
      join(workspaceRoot, 'packages', packageName.replace(/^@[^/]+\//, '')), // @scope/name -> name
      join(workspaceRoot, 'packages', packageName), // direct name
      join(workspaceRoot, 'libs', packageName.replace(/^@[^/]+\//, '')),
      join(workspaceRoot, 'libs', packageName),
      join(workspaceRoot, 'apps', packageName.replace(/^@[^/]+\//, '')),
      join(workspaceRoot, 'apps', packageName),
      // Handle shared specifically for @botwork/shared -> packages/shared
      join(workspaceRoot, 'packages', 'shared'),
    ];

    for (const path of possiblePaths) {
      if (existsSync(join(path, 'package.json'))) {
        try {
          const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
          if (pkg.name === packageName) {
            return true;
          }
        } catch {
          // Invalid package.json, continue
        }
      }
    }
    return false;
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
