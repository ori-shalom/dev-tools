import { createWriteStream } from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';
import archiver from 'archiver';
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

    // Determine output directory
    const packageOutputDir = outputDir || join(workingDir, 'lambda-packages');
    mkdirSync(packageOutputDir, { recursive: true });

    // Create ZIP file path
    const zipPath = join(packageOutputDir, `${bundleResult.functionName}.zip`);

    // Create a file to stream archive data to
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Return a promise that resolves when the archive is finalized
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        const size = archive.pointer();
        resolve({
          functionName: bundleResult.functionName,
          zipPath,
          size,
        });
      });

      output.on('error', reject);
      archive.on('error', reject);

      // Pipe archive data to the file
      archive.pipe(output);

      // Add the entire bundled output directory to the archive
      archive.directory(bundleResult.outputPath, false);

      // Finalize the archive
      archive.finalize();
    });
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
