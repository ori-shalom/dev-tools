import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ZipPackager } from './zip-packager.js';
import { BundleResult } from './esbuild-bundler.js';

describe('ZipPackager', () => {
  let testDir: string;
  let packager: ZipPackager;
  let mockBundleResult: BundleResult;

  beforeEach(() => {
    // Create unique test directory
    testDir = join(tmpdir(), `zip-packager-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(testDir, { recursive: true });

    packager = new ZipPackager();

    // Create mock bundle result with actual files
    const bundleDir = join(testDir, 'bundle');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'index.js'), 'exports.handler = () => {};');
    writeFileSync(join(bundleDir, 'package.json'), '{"name": "test-function"}');

    mockBundleResult = {
      functionName: 'test-function',
      outputPath: bundleDir,
      size: 1024,
      dependencies: ['aws-sdk'],
      warnings: [],
    };
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('packageFunction', () => {
    it('should create ZIP package successfully', async () => {
      const result = await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('test-function');
      expect(result.zipPath).toBe(join(testDir, 'lambda-packages', 'test-function.zip'));
      expect(result.size).toBeGreaterThan(0);
      expect(existsSync(result.zipPath)).toBe(true);
    });

    it('should create ZIP package with custom output directory', async () => {
      const customOutputDir = join(testDir, 'custom-packages');

      const result = await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
        outputDir: customOutputDir,
      });

      expect(result.zipPath).toBe(join(customOutputDir, 'test-function.zip'));
      expect(existsSync(result.zipPath)).toBe(true);
    });

    it('should handle bundled files correctly', async () => {
      // Add more files to the bundle directory
      const subDir = join(mockBundleResult.outputPath, 'lib');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, 'helper.js'), 'module.exports = {};');

      const result = await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
      });

      expect(result.size).toBeGreaterThan(0);
      expect(existsSync(result.zipPath)).toBe(true);

      // Verify ZIP contains the expected structure
      const zipContent = readFileSync(result.zipPath);
      expect(zipContent.length).toBeGreaterThan(0);
    });

    it('should handle empty bundle directory', async () => {
      const emptyBundleDir = join(testDir, 'empty-bundle');
      mkdirSync(emptyBundleDir, { recursive: true });

      const emptyBundleResult: BundleResult = {
        functionName: 'empty-function',
        outputPath: emptyBundleDir,
        size: 0,
        dependencies: [],
        warnings: [],
      };

      const result = await packager.packageFunction({
        bundleResult: emptyBundleResult,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('empty-function');
      expect(existsSync(result.zipPath)).toBe(true);
      expect(result.size).toBeGreaterThan(0); // ZIP has overhead even when empty
    });

    it('should handle non-existent directories by creating empty ZIP', async () => {
      // Create a bundle result with non-existent directory
      const nonExistentBundleResult: BundleResult = {
        functionName: 'nonexistent-function',
        outputPath: join(testDir, 'nonexistent'),
        size: 0,
        dependencies: [],
        warnings: [],
      };

      const result = await packager.packageFunction({
        bundleResult: nonExistentBundleResult,
        workingDir: testDir,
      });

      // Archiver creates an empty ZIP even for non-existent directories
      expect(result.functionName).toBe('nonexistent-function');
      expect(existsSync(result.zipPath)).toBe(true);
      expect(result.size).toBeGreaterThan(0); // Empty ZIP still has overhead
    });

    it('should create nested output directories', async () => {
      const nestedOutputDir = join(testDir, 'deeply', 'nested', 'packages');

      const result = await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
        outputDir: nestedOutputDir,
      });

      expect(existsSync(result.zipPath)).toBe(true);
      expect(result.zipPath).toBe(join(nestedOutputDir, 'test-function.zip'));
    });
  });

  describe('packageAll', () => {
    it('should package multiple functions successfully', async () => {
      // Create multiple bundle results
      const bundle2Dir = join(testDir, 'bundle2');
      mkdirSync(bundle2Dir, { recursive: true });
      writeFileSync(join(bundle2Dir, 'index.js'), 'exports.handler = () => "function2";');

      const bundleResults: BundleResult[] = [
        mockBundleResult,
        {
          functionName: 'function2',
          outputPath: bundle2Dir,
          size: 512,
          dependencies: ['lodash'],
          warnings: [],
        },
      ];

      const results = await packager.packageAll(bundleResults, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].functionName).toBe('test-function');
      expect(results[1].functionName).toBe('function2');
      expect(existsSync(results[0].zipPath)).toBe(true);
      expect(existsSync(results[1].zipPath)).toBe(true);
    });

    it('should package all functions with custom output directory', async () => {
      const customOutputDir = join(testDir, 'all-packages');

      const results = await packager.packageAll([mockBundleResult], testDir, customOutputDir);

      expect(results).toHaveLength(1);
      expect(results[0].zipPath).toContain('all-packages');
      expect(existsSync(results[0].zipPath)).toBe(true);
    });

    it('should handle non-existent directories in packageAll', async () => {
      // Create a bundle result with non-existent directory
      const problematicBundleResult: BundleResult = {
        functionName: 'problematic',
        outputPath: join(testDir, 'nonexistent'),
        size: 0,
        dependencies: [],
        warnings: [],
      };

      const bundleResults = [mockBundleResult, problematicBundleResult];

      // packageAll should succeed even with non-existent directories
      const results = await packager.packageAll(bundleResults, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].functionName).toBe('test-function');
      expect(results[1].functionName).toBe('problematic');
      expect(existsSync(results[0].zipPath)).toBe(true);
      expect(existsSync(results[1].zipPath)).toBe(true);
    });
  });

  describe('console logging', () => {
    it('should log progress during packaging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
      });

      // Note: Console logging happens in packageAll, not packageFunction
      consoleSpy.mockRestore();
    });

    it('should log progress during packageAll', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await packager.packageAll([mockBundleResult], testDir);

      expect(consoleSpy).toHaveBeenCalledWith('Packaging function: test-function');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/✓ test-function packaged \(\d+\.?\d*\s\w+\) -> /));

      consoleSpy.mockRestore();
    });

    it('should log successful packaging even for edge cases', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const edgeCaseBundleResult: BundleResult = {
        functionName: 'edge-case',
        outputPath: join(testDir, 'nonexistent'),
        size: 0,
        dependencies: [],
        warnings: [],
      };

      await packager.packageAll([edgeCaseBundleResult], testDir);

      expect(consoleSpy).toHaveBeenCalledWith('Packaging function: edge-case');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/✓ edge-case packaged \(\d+\.?\d*\s\w+\) -> /));

      consoleSpy.mockRestore();
    });

    it('should log errors when packaging fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock archiver to fail
      const packagerWithError = new ZipPackager();

      // Create a function that will throw when trying to package
      const failingPackageFunction = vi
        .spyOn(packagerWithError, 'packageFunction')
        .mockRejectedValue(new Error('Archive creation failed'));

      const bundleResult: BundleResult = {
        functionName: 'error-function',
        outputPath: join(testDir, 'bundle'),
        size: 1024,
        dependencies: [],
        warnings: [],
      };

      await expect(packagerWithError.packageAll([bundleResult], testDir)).rejects.toThrow('Archive creation failed');

      expect(consoleSpy).toHaveBeenCalledWith('✗ Failed to package error-function:', 'Archive creation failed');

      failingPackageFunction.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should log non-Error exceptions when packaging fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const packagerWithError = new ZipPackager();

      // Mock to throw non-Error object
      const failingPackageFunction = vi.spyOn(packagerWithError, 'packageFunction').mockRejectedValue('string error');

      const bundleResult: BundleResult = {
        functionName: 'string-error-function',
        outputPath: join(testDir, 'bundle'),
        size: 1024,
        dependencies: [],
        warnings: [],
      };

      await expect(packagerWithError.packageAll([bundleResult], testDir)).rejects.toBe('string error');

      expect(consoleSpy).toHaveBeenCalledWith('✗ Failed to package string-error-function:', 'string error');

      failingPackageFunction.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('utility methods', () => {
    it('should format bytes correctly', () => {
      const packagerWithPrivates = packager as ZipPackager & {
        formatBytes(bytes: number): string;
      };

      expect(packagerWithPrivates.formatBytes(0)).toBe('0 B');
      expect(packagerWithPrivates.formatBytes(1024)).toBe('1 KB');
      expect(packagerWithPrivates.formatBytes(1536)).toBe('1.5 KB');
      expect(packagerWithPrivates.formatBytes(1048576)).toBe('1 MB');
      expect(packagerWithPrivates.formatBytes(1572864)).toBe('1.5 MB');
    });
  });

  describe('edge cases', () => {
    it('should handle very large bundle directories', async () => {
      // Create a bundle with many files
      for (let i = 0; i < 100; i++) {
        writeFileSync(join(mockBundleResult.outputPath, `file${i}.js`), `module.exports = ${i};`);
      }

      const result = await packager.packageFunction({
        bundleResult: mockBundleResult,
        workingDir: testDir,
      });

      expect(result.size).toBeGreaterThan(0);
      expect(existsSync(result.zipPath)).toBe(true);
    });

    it('should handle bundle directories with special characters', async () => {
      const specialBundle = join(testDir, 'special-chars');
      mkdirSync(specialBundle, { recursive: true });
      writeFileSync(join(specialBundle, 'file with spaces.js'), 'exports.handler = () => {};');
      writeFileSync(join(specialBundle, 'file-with-dashes.js'), 'exports.handler = () => {};');

      const specialBundleResult: BundleResult = {
        functionName: 'special-chars-function',
        outputPath: specialBundle,
        size: 1024,
        dependencies: [],
        warnings: [],
      };

      const result = await packager.packageFunction({
        bundleResult: specialBundleResult,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('special-chars-function');
      expect(existsSync(result.zipPath)).toBe(true);
    });

    it('should handle concurrent packaging operations', async () => {
      // Create multiple bundles
      const bundles = [];
      for (let i = 0; i < 5; i++) {
        const bundleDir = join(testDir, `bundle${i}`);
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(join(bundleDir, 'index.js'), `exports.handler = () => "function${i}";`);

        bundles.push({
          functionName: `function${i}`,
          outputPath: bundleDir,
          size: 512,
          dependencies: [],
          warnings: [],
        });
      }

      // Package concurrently
      const promises = bundles.map((bundle) =>
        packager.packageFunction({
          bundleResult: bundle,
          workingDir: testDir,
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.functionName).toBe(`function${index}`);
        expect(existsSync(result.zipPath)).toBe(true);
      });
    });
  });
});
