import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { ConfigParser } from '../../config/parser.js';
import { ESBuildBundler } from '../../bundler/esbuild-bundler.js';
import { ZipPackager } from '../../bundler/zip-packager.js';

export function createPackageCommand(): Command {
  const command = new Command('package');

  command
    .description('Build and package Lambda functions')
    .option('-c, --config <path>', 'Configuration file path', 'dev-tools.yaml')
    .option('-o, --output <dir>', 'Output directory for packages', 'lambda-packages')
    .option('--no-minify', 'Disable code minification')
    .option('--sourcemap', 'Generate source maps')
    .option('-f, --function <name>', 'Package specific function only')
    .action(async (options) => {
      await runPackageCommand(options);
    });

  return command;
}

type PackageOptions = {
  config: string;
  output: string;
  minify: boolean;
  sourcemap?: boolean;
  function?: string;
};

async function runPackageCommand(options: PackageOptions): Promise<void> {
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

    console.log(`Packaging Lambda functions for service: ${config.service}`);
    console.log(`Build configuration:`);
    console.log(`  - Target: ${config.build.target}`);
    console.log(`  - Minify: ${config.build.minify}`);
    console.log(`  - Source maps: ${config.build.sourcemap}`);
    console.log(`  - Output dir: ${config.build.outDir}`);

    // Filter functions if specific function requested
    let functionsToPackage = config.functions;
    if (options.function) {
      if (!config.functions[options.function]) {
        console.error(`Function '${options.function}' not found in configuration`);
        process.exit(1);
      }
      functionsToPackage = { [options.function]: config.functions[options.function] };
    }

    console.log(`\nFunctions to package: ${Object.keys(functionsToPackage).join(', ')}`);

    // Initialize bundler and packager
    const bundler = new ESBuildBundler(config.build);
    const packager = new ZipPackager();

    // Build all functions
    console.log('\n📦 Building functions...');
    const bundleResults = await bundler.bundleAll({ ...config, functions: functionsToPackage }, process.cwd());

    // Package all functions
    console.log('\n📦 Creating deployment packages...');
    const packageResults = await packager.packageAll(bundleResults, process.cwd(), options.output);

    // Print summary
    console.log('\n✅ Packaging completed successfully!');
    console.log('\nPackage Summary:');
    console.log('================');

    let totalBundleSize = 0;
    let totalPackageSize = 0;

    packageResults.forEach((result) => {
      const bundleResult = bundleResults.find((b) => b.functionName === result.functionName);
      if (bundleResult) {
        console.log(`\n📦 ${result.functionName}:`);
        console.log(`   Handler: ${functionsToPackage[result.functionName].handler}`);
        console.log(`   Bundle size: ${formatBytes(bundleResult.size)}`);
        console.log(`   Package size: ${formatBytes(result.size)}`);
        console.log(`   Package path: ${result.zipPath}`);

        if (bundleResult.warnings.length > 0) {
          console.log(`   ⚠️  Warnings: ${bundleResult.warnings.length}`);
        }

        totalBundleSize += bundleResult.size;
        totalPackageSize += result.size;
      }
    });

    console.log(`\n📊 Total bundle size: ${formatBytes(totalBundleSize)}`);
    console.log(`📊 Total package size: ${formatBytes(totalPackageSize)}`);

    // Show warnings if any
    const allWarnings = bundleResults.flatMap((r) => r.warnings);
    if (allWarnings.length > 0) {
      console.log(`\n⚠️  Build warnings (${allWarnings.length}):`);
      allWarnings.forEach((warning) => console.log(`   ${warning}`));
    }

    console.log('\n🎉 Ready for deployment!');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to package functions: ${error.message}`);
    } else {
      console.error('Failed to package functions:', error);
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
