import { resolve, extname, dirname } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync } from 'fs';
import { build, Plugin, PluginBuild, OnResolveArgs } from 'esbuild';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createDebugLoggers } from './debug-logger.js';

export type DebugOptions = {
  workspace?: boolean;
  traceImports?: boolean;
  bundle?: boolean;
  runtime?: boolean;
};

export class HandlerLoader {
  private cache = new Map<string, unknown>();
  private tempDir: string;
  private debug: DebugOptions;
  private logger: ReturnType<typeof createDebugLoggers>;

  constructor(debug: DebugOptions = {}) {
    this.debug = debug;
    this.logger = createDebugLoggers(debug);
    this.tempDir = join(tmpdir(), '@ori-sh/dev-tools', Date.now().toString());
    mkdirSync(this.tempDir, { recursive: true });

    this.logger.runtime.group('[RUNTIME DEBUG] Handler execution environment:');
    this.logger.runtime.item(`Working directory: ${this.tempDir}`);
    this.logger.runtime.item(`NODE_PATH: ${process.env.NODE_PATH || 'undefined'}`);
    this.logger.runtime.item(`Original project root: ${process.cwd()}`);
  }

  private setupNodeModulesSymlink(projectRoot: string): void {
    // Find the nearest node_modules directory from the project root
    const nodeModulesPath = this.findNodeModules(projectRoot);

    if (!nodeModulesPath) {
      this.logger.runtime.warn('No node_modules found, native dependencies may fail to resolve');
      return;
    }

    const tempNodeModulesPath = join(this.tempDir, 'node_modules');

    try {
      // Create symlink to the original node_modules
      symlinkSync(nodeModulesPath, tempNodeModulesPath, 'dir');
      this.logger.runtime.item(`✅ Created node_modules symlink: ${tempNodeModulesPath} -> ${nodeModulesPath}`);
    } catch (error) {
      // Symlink might already exist or permissions issue
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        this.logger.runtime.item(`node_modules symlink already exists`);
      } else {
        this.logger.runtime.error(
          `Failed to create node_modules symlink: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  private findNodeModules(startDir: string): string | null {
    let currentDir = startDir;
    const root = resolve('/');

    while (currentDir !== root) {
      const nodeModulesPath = join(currentDir, 'node_modules');
      if (existsSync(nodeModulesPath)) {
        this.logger.runtime.item(`Found node_modules at: ${nodeModulesPath}`);
        return nodeModulesPath;
      }
      currentDir = dirname(currentDir);
    }

    this.logger.runtime.warn('No node_modules directory found');
    return null;
  }

  async loadHandler(handlerPath: string, workingDir: string): Promise<unknown> {
    const cacheKey = `${workingDir}:${handlerPath}`;

    this.logger.traceImports.group(`[IMPORT DEBUG] Loading handler: ${handlerPath}`);
    this.logger.traceImports.item(`Working directory: ${workingDir}`);
    this.logger.traceImports.item(`Cache key: ${cacheKey}`);

    // Clear cache for hot reload
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
      this.logger.traceImports.item('Cleared cache for hot reload');
    }

    // Resolve the handler file path
    const [filePath, exportName = 'handler'] = handlerPath.split('.');
    const resolvedPath = this.resolveHandlerFile(filePath, workingDir);

    if (!resolvedPath) {
      throw new Error(`Handler file not found: ${filePath}`);
    }

    this.logger.traceImports.item(`Resolved handler file: ${resolvedPath}`);
    this.logger.traceImports.item(`Export name: ${exportName}`);

    // Build the handler file if it's TypeScript
    const builtPath = await this.buildHandler(resolvedPath);

    this.logger.traceImports.item(`Built handler path: ${builtPath}`);

    // Setup node_modules symlink for native dependency resolution
    this.setupNodeModulesSymlink(workingDir);

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

    this.logger.bundle.group('[BUNDLE DEBUG] Handler bundling phase:');
    this.logger.bundle.item(`Handler path: ${handlerPath}`);
    this.logger.bundle.item(`File extension: ${ext}`);

    // If it's already JavaScript, return as-is
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs') {
      this.logger.bundle.item('Already JavaScript, skipping bundle');
      return handlerPath;
    }

    // Build TypeScript to JavaScript
    const outputPath = join(this.tempDir, `${Date.now()}.js`);

    this.logger.bundle.item(`Temporary bundle path: ${outputPath}`);

    // Get external dependencies to exclude from bundling
    const externalDeps = this.getExternalDependencies(handlerPath);

    this.logger.bundle.item(`External dependencies: [${externalDeps.join(', ')}]`);

    // Create custom plugin to resolve workspace packages
    const workspacePlugin = this.createWorkspaceResolverPlugin(handlerPath);

    const buildConfig = {
      entryPoints: [handlerPath],
      bundle: true, // Enable bundling to resolve relative imports
      platform: 'node' as const,
      target: 'node22',
      format: 'esm' as const,
      outfile: outputPath,
      allowOverwrite: true,
      external: externalDeps, // Exclude native and node_modules dependencies
      loader: {
        '.ts': 'ts' as const,
        '.tsx': 'tsx' as const,
        '.jsx': 'jsx' as const,
      },
      // Resolve from the handler's directory context
      absWorkingDir: dirname(handlerPath),
      // Handle workspace packages and TypeScript resolution
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'],
      mainFields: ['main', 'module', 'exports'],
      conditions: ['node', 'import', 'require'],
      plugins: [workspacePlugin],
    };

    this.logger.bundle.group('[BUNDLE DEBUG] ESBuild configuration:');
    this.logger.bundle.item(`bundle: ${buildConfig.bundle}`);
    this.logger.bundle.item(`platform: ${buildConfig.platform}`);
    this.logger.bundle.item(`target: ${buildConfig.target}`);
    this.logger.bundle.item(`format: ${buildConfig.format}`);
    this.logger.bundle.item(`absWorkingDir: ${buildConfig.absWorkingDir}`);

    await build(buildConfig);

    // Analyze the generated bundle
    try {
      const bundleContent = readFileSync(outputPath, 'utf8');
      this.logger.bundle.group('[BUNDLE DEBUG] Post-bundle analysis:');
      this.logger.bundle.item(`Generated bundle size: ${bundleContent.length} characters`);

      // Check for import statements that should be resolved at runtime
      const importMatches = bundleContent.match(/import\s+.*?\s+from\s+['"][^'"]+['"]/g) || [];
      if (importMatches.length > 0) {
        this.logger.bundle.item(`External imports in bundle: ${importMatches.length}`);
        importMatches.forEach((match, i) => {
          this.logger.bundle.subItem(`${i + 1}. ${match}`);
        });
      } else {
        this.logger.bundle.item('No external imports found in bundle');
      }
    } catch {
      this.logger.bundle.warn('Could not analyze bundle content');
    }

    return outputPath;
  }

  private createWorkspaceResolverPlugin(handlerPath: string): Plugin {
    // Find workspace root by scanning upward from handler directory
    const workspaceRoot = this.findWorkspaceRoot(dirname(handlerPath));

    if (!workspaceRoot) {
      this.logger.workspace.warn('No workspace root found for plugin, workspace resolution disabled');
      return { name: 'workspace-resolver', setup: () => {} };
    }

    // Get dependencies from nearest package.json
    const packageJsonPath = this.findPackageJson(dirname(handlerPath));
    if (!packageJsonPath) {
      this.logger.workspace.warn('No package.json found for plugin');
      return { name: 'workspace-resolver', setup: () => {} };
    }

    let workspacePackages: string[] = [];
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };
      workspacePackages = this.getWorkspacePackagesFromRoot(workspaceRoot, deps);
    } catch (error) {
      this.logger.workspace.error(
        `Failed to read dependencies for plugin: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { name: 'workspace-resolver', setup: () => {} };
    }

    this.logger.workspace.group(`[WORKSPACE PLUGIN] Configuring workspace resolver:`);
    this.logger.workspace.item(`Workspace root: ${workspaceRoot}`);
    this.logger.workspace.item(`Packages to resolve: [${workspacePackages.join(', ')}]`);

    return {
      name: 'workspace-resolver',
      setup: (build: PluginBuild) => {
        // Resolve workspace packages to their actual file paths
        build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
          if (workspacePackages.includes(args.path)) {
            const resolvedPath = this.resolveWorkspacePath(args.path, workspaceRoot);
            if (resolvedPath) {
              this.logger.workspace.item(`🔄 Resolving ${args.path} -> ${resolvedPath}`);
              return {
                path: resolvedPath,
                // Force bundling of workspace packages
                external: false,
              };
            } else {
              this.logger.workspace.error(`❌ Failed to resolve workspace path: ${args.path}`);
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

        // Find workspace root (scan upward from handler directory)
        const workspaceRoot = this.findWorkspaceRoot(dirname(handlerPath));

        // Get workspace packages - these will be BUNDLED, not external
        const workspacePackages = this.getWorkspacePackagesFromRoot(workspaceRoot, allDeps);

        this.logger.workspace.item(`Workspace packages (will be bundled): [${workspacePackages.join(', ')}]`);
        this.logger.workspace.item(
          `External dependencies: [${Object.keys(allDeps)
            .filter((dep) => !workspacePackages.includes(dep))
            .join(', ')}]`,
        );

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
        this.logger.workspace.warn('Could not read package.json, using fallback external list');
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

  private getWorkspacePackagesFromRoot(workspaceRoot: string | null, deps: Record<string, string>): string[] {
    const workspacePackages: string[] = [];

    if (!workspaceRoot) {
      this.logger.workspace.warn('No workspace root found, treating all dependencies as external');
      return workspacePackages;
    }

    this.logger.workspace.group(`[WORKSPACE DEBUG] Analyzing workspace at: ${workspaceRoot}`);
    this.logger.workspace.item(`Dependencies to analyze: [${Object.keys(deps).join(', ')}]`);

    try {
      // Check for pnpm workspace
      const pnpmWorkspacePath = join(workspaceRoot, 'pnpm-workspace.yaml');
      if (existsSync(pnpmWorkspacePath)) {
        this.logger.workspace.item(`Using pnpm workspace configuration`);
        Object.keys(deps).forEach((dep) => {
          // pnpm workspace patterns
          if (deps[dep].startsWith('workspace:') || this.isPackageInWorkspace(dep, workspaceRoot)) {
            this.logger.workspace.item(`✓ Workspace package: ${dep} (${deps[dep]})`);
            workspacePackages.push(dep);
          }
        });
      } else {
        // Check for npm/yarn workspaces in workspace root package.json
        const rootPackageJsonPath = join(workspaceRoot, 'package.json');
        if (existsSync(rootPackageJsonPath)) {
          const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
          if (rootPackageJson.workspaces) {
            this.logger.workspace.item(
              `Using npm/yarn workspace configuration: ${JSON.stringify(rootPackageJson.workspaces)}`,
            );
            Object.keys(deps).forEach((dep) => {
              // npm/yarn workspace patterns
              if (
                deps[dep] === '*' ||
                deps[dep].startsWith('workspace:') ||
                this.isPackageInWorkspace(dep, workspaceRoot)
              ) {
                this.logger.workspace.item(`✓ Workspace package: ${dep} (${deps[dep]})`);
                workspacePackages.push(dep);
              }
            });
          }
        }
      }

      // Fallback: filesystem scan for packages that might be workspace packages but not declared properly
      if (workspacePackages.length === 0) {
        this.logger.workspace.warn('No workspace packages detected via config, scanning filesystem...');
        Object.keys(deps).forEach((dep) => {
          if (this.isPackageInWorkspace(dep, workspaceRoot)) {
            this.logger.workspace.item(`✓ Found workspace package via filesystem: ${dep}`);
            workspacePackages.push(dep);
          }
        });
      }

      // Log resolution details
      this.logger.workspace.group('[WORKSPACE DEBUG] Package resolution details:');
      if (workspacePackages.length > 0) {
        workspacePackages.forEach((pkg) => {
          const resolvedPath = this.resolveWorkspacePath(pkg, workspaceRoot);
          if (resolvedPath) {
            this.logger.workspace.item(`✅ ${pkg} -> ${resolvedPath}`);
          } else {
            this.logger.workspace.error(`❌ ${pkg} -> RESOLUTION FAILED`);
          }
        });
      } else {
        this.logger.workspace.warn('No workspace packages detected');
      }
    } catch (error) {
      this.logger.workspace.error(
        `Error analyzing workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return workspacePackages;
  }

  // Keep old method for backward compatibility with createWorkspaceResolverPlugin
  private getWorkspacePackages(packageJsonPath: string): string[] {
    const workspaceRoot = this.findWorkspaceRoot(dirname(packageJsonPath));
    if (!workspaceRoot) {
      return [];
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      };
      return this.getWorkspacePackagesFromRoot(workspaceRoot, deps);
    } catch {
      return [];
    }
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

  private findWorkspaceRoot(startDir: string): string | null {
    let currentDir = startDir;
    const root = resolve('/');

    while (currentDir !== root) {
      // Check for pnpm workspace
      const pnpmWorkspacePath = join(currentDir, 'pnpm-workspace.yaml');
      if (existsSync(pnpmWorkspacePath)) {
        this.logger.workspace.item(`Found pnpm-workspace.yaml at: ${pnpmWorkspacePath}`);
        return currentDir;
      }

      // Check for npm/yarn workspace in package.json
      const packageJsonPath = join(currentDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
          if (packageJson.workspaces) {
            this.logger.workspace.item(`Found npm/yarn workspace at: ${packageJsonPath}`);
            return currentDir;
          }
        } catch {
          // Invalid package.json, continue searching
        }
      }

      currentDir = dirname(currentDir);
    }

    this.logger.workspace.warn('No workspace root found');
    return null;
  }

  private async importHandler(builtPath: string, exportName: string): Promise<unknown> {
    if (this.debug.runtime || this.debug.traceImports) {
      console.log('[RUNTIME DEBUG] Module resolution attempt:');
      console.log(`  - Built path: ${builtPath}`);
      console.log(`  - Export name: ${exportName}`);

      // Check if the bundle file exists and show some details
      if (existsSync(builtPath)) {
        const bundleContent = readFileSync(builtPath, 'utf8');
        console.log(`  - Bundle size: ${bundleContent.length} characters`);

        // Show any import statements that need runtime resolution
        const importMatches = bundleContent.match(/import\s+.*?\s+from\s+['"][^'"]+['"]/g) || [];
        if (importMatches.length > 0) {
          console.log(`  - Bundle contains ${importMatches.length} external import(s):`);
          importMatches.forEach((match, i) => {
            console.log(`    ${i + 1}. ${match}`);
          });
        }
      }
    }

    try {
      // Import the module using dynamic import for ESM compatibility
      const moduleUrl = `file://${builtPath}?t=${Date.now()}`;

      if (this.debug.runtime) {
        console.log(`  - Attempting dynamic import: ${moduleUrl}`);
      }

      const module = await import(moduleUrl);

      if (this.debug.runtime) {
        console.log(`  - Import successful, available exports: [${Object.keys(module).join(', ')}]`);
      }

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

      if (this.debug.runtime) {
        console.log(`  - Handler function found: ${actualExportName}`);
      }

      return handler;
    } catch (error) {
      if (this.debug.runtime || this.debug.traceImports) {
        console.log('[RUNTIME DEBUG] Import failed:');
        if (error instanceof Error) {
          console.log(`  - Error: ${error.message}`);
          console.log(`  - Stack: ${error.stack}`);
        }

        // Provide diagnostic information
        console.log('[RUNTIME DEBUG] Diagnostic information:');
        console.log(`  - Working directory: ${process.cwd()}`);
        console.log(`  - Temp directory: ${this.tempDir}`);
        console.log(`  - Temp dir exists: ${existsSync(this.tempDir)}`);
        console.log(`  - Built file exists: ${existsSync(builtPath)}`);

        if (existsSync(this.tempDir)) {
          const tempFiles = readdirSync(this.tempDir);
          console.log(`  - Temp directory contents: [${tempFiles.join(', ')}]`);
        }
      }

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
