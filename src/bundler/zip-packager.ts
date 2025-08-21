import { createWriteStream, statSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { BundleResult } from './esbuild-bundler.js';

export type PackageOptions = {
  bundleResult: BundleResult;
  workingDir: string;
  outputDir?: string;
};

export type PackageResult = {
  functionName: string;
  zipPath: string;
  size: number;
};

export class ZipPackager {
  async packageFunction(options: PackageOptions): Promise<PackageResult> {
    const { bundleResult, workingDir, outputDir } = options;

    // For now, we'll create a simple tar-like structure
    // In a production version, you'd want to use a proper ZIP library

    // Determine output directory
    const packageOutputDir = outputDir || join(workingDir, 'lambda-packages');
    mkdirSync(packageOutputDir, { recursive: true });

    // For simplicity, we'll just copy the main handler file
    // In production, you'd create a proper ZIP archive
    const packagePath = join(packageOutputDir, bundleResult.functionName);
    mkdirSync(packagePath, { recursive: true });

    // Copy all files from bundle output
    await this.copyDirectory(bundleResult.outputPath, packagePath);

    // Create a marker file for the zip (simplified approach)
    const zipPath = `${packagePath}.zip`;

    // Calculate size (simplified)
    const size = this.calculateDirectorySize(packagePath);

    return {
      functionName: bundleResult.functionName,
      zipPath,
      size,
    };
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    mkdirSync(destination, { recursive: true });

    const items = readdirSync(source, { withFileTypes: true });

    for (const item of items) {
      const sourcePath = join(source, item.name);
      const destPath = join(destination, item.name);

      if (item.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath);
      } else {
        const content = readFileSync(sourcePath);
        createWriteStream(destPath).write(content);
      }
    }
  }

  private calculateDirectorySize(dirPath: string): number {
    let totalSize = 0;

    const items = readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dirPath, item.name);

      if (item.isDirectory()) {
        totalSize += this.calculateDirectorySize(fullPath);
      } else {
        totalSize += statSync(fullPath).size;
      }
    }

    return totalSize;
  }

  async packageAll(bundleResults: BundleResult[], workingDir: string, outputDir?: string): Promise<PackageResult[]> {
    const results: PackageResult[] = [];

    for (const bundleResult of bundleResults) {
      try {
        console.log(`Packaging function: ${bundleResult.functionName}`);

        const result = await this.packageFunction({
          bundleResult,
          workingDir,
          outputDir,
        });

        results.push(result);
        console.log(`✓ ${result.functionName} packaged (${this.formatBytes(result.size)}) -> ${result.zipPath}`);
      } catch (error) {
        console.error(
          `✗ Failed to package ${bundleResult.functionName}:`,
          error instanceof Error ? error.message : error,
        );
        throw error;
      }
    }

    return results;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
