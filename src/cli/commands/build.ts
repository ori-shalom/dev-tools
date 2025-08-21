import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { ConfigParser } from '../../config/parser.js';
import { ESBuildBundler } from '../../bundler/esbuild-bundler.js';

export function createBuildCommand(): Command {
  const command = new Command('build');

  command
    .description('Build Lambda functions without packaging')
    .option('-c, --config <path>', 'Configuration file path', 'dev-tools.yaml')
    .option('--no-minify', 'Disable code minification')
    .option('--sourcemap', 'Generate source maps')
    .option('-f, --function <name>', 'Build specific function only')
    .action(async (options) => {
      await runBuildCommand(options);
    });

  return command;
}

type BuildOptions = {
  config: string;
  minify: boolean;
  sourcemap?: boolean;
  function?: string;
};

async function runBuildCommand(options: BuildOptions): Promise<void> {
  const configPath = resolve(process.cwd(), options.config);

  if (!existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    console.log('Create a dev-tools.yaml file or specify a different path with --config');
    process.exit(1);
  }

  try {
    // Parse configuration
    console.log(`Loading configuration from: ${configPath}`);
    const config = ConfigParser.parseFile(configPath);

    // Override build options from CLI
    if (options.minify === false) {
      config.build.minify = false;
    }
    if (options.sourcemap) {
      config.build.sourcemap = true;
    }

    console.log(`Building Lambda functions for service: ${config.service}`);
    console.log(`Build configuration:`);
    console.log(`  - Target: ${config.build.target}`);
    console.log(`  - Minify: ${config.build.minify}`);
    console.log(`  - Source maps: ${config.build.sourcemap}`);
    console.log(`  - Output dir: ${config.build.outDir}`);

    // Filter functions if specific function requested
    let functionsToBuild = config.functions;
    if (options.function) {
      if (!config.functions[options.function]) {
        console.error(`Function '${options.function}' not found in configuration`);
        process.exit(1);
      }
      functionsToBuild = { [options.function]: config.functions[options.function] };
    }

    console.log(`\nFunctions to build: ${Object.keys(functionsToBuild).join(', ')}`);

    // Initialize bundler
    const bundler = new ESBuildBundler(config.build);

    // Build all functions
    console.log('\n📦 Building functions...');
    const bundleResults = await bundler.bundleAll({ ...config, functions: functionsToBuild }, process.cwd());

    // Print summary
    console.log('\n✅ Build completed successfully!');
    console.log('\nBuild Summary:');
    console.log('================');

    let totalBundleSize = 0;

    bundleResults.forEach((result) => {
      console.log(`\n📦 ${result.functionName}:`);
      console.log(`   Handler: ${functionsToBuild[result.functionName].handler}`);
      console.log(`   Bundle size: ${formatBytes(result.size)}`);
      console.log(`   Output path: ${result.outputPath}`);

      if (result.warnings.length > 0) {
        console.log(`   ⚠️  Warnings: ${result.warnings.length}`);
      }

      totalBundleSize += result.size;
    });

    console.log(`\n📊 Total bundle size: ${formatBytes(totalBundleSize)}`);

    // Show warnings if any
    const allWarnings = bundleResults.flatMap((r) => r.warnings);
    if (allWarnings.length > 0) {
      console.log(`\n⚠️  Build warnings (${allWarnings.length}):`);
      allWarnings.forEach((warning) => console.log(`   ${warning}`));
    }

    console.log('\n🎉 Build artifacts ready!');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to build functions: ${error.message}`);
    } else {
      console.error('Failed to build functions:', error);
    }
    process.exit(1);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
