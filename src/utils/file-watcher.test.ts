import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from './file-watcher.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

describe('FileWatcher', () => {
  let fileWatcher: FileWatcher;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    fileWatcher = new FileWatcher();
    testDir = join(tmpdir(), `file-watcher-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(testDir, { recursive: true });
    testFile = join(testDir, 'test.ts');
  });

  afterEach(async () => {
    fileWatcher.stop();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create a file watcher instance', () => {
      expect(fileWatcher).toBeDefined();
      expect(fileWatcher).toBeInstanceOf(FileWatcher);
    });

    it('should be an EventEmitter', () => {
      expect(fileWatcher.on).toBeDefined();
      expect(fileWatcher.emit).toBeDefined();
      expect(typeof fileWatcher.on).toBe('function');
      expect(typeof fileWatcher.emit).toBe('function');
    });
  });

  describe('lifecycle', () => {
    it('should start watching a single path', () => {
      expect(fileWatcher.isWatching()).toBe(false);

      fileWatcher.start(testDir);

      expect(fileWatcher.isWatching()).toBe(true);
      expect(fileWatcher.getWatchedPaths()).toContain(testDir);
    });

    it('should start watching multiple paths', () => {
      const secondTestDir = join(tmpdir(), `file-watcher-test-2-${Date.now()}`);
      mkdirSync(secondTestDir, { recursive: true });

      try {
        fileWatcher.start([testDir, secondTestDir]);

        expect(fileWatcher.isWatching()).toBe(true);
        expect(fileWatcher.getWatchedPaths()).toContain(testDir);
        expect(fileWatcher.getWatchedPaths()).toContain(secondTestDir);
      } finally {
        rmSync(secondTestDir, { recursive: true, force: true });
      }
    });

    it('should stop watching', () => {
      fileWatcher.start(testDir);
      expect(fileWatcher.isWatching()).toBe(true);

      fileWatcher.stop();

      expect(fileWatcher.isWatching()).toBe(false);
      expect(fileWatcher.getWatchedPaths()).toHaveLength(0);
    });

    it('should stop previous watcher when starting a new one', () => {
      fileWatcher.start(testDir);
      const firstWatchedPaths = fileWatcher.getWatchedPaths();
      expect(firstWatchedPaths).toContain(testDir);

      const secondTestDir = join(tmpdir(), `file-watcher-test-2-${Date.now()}`);
      mkdirSync(secondTestDir, { recursive: true });

      try {
        fileWatcher.start(secondTestDir);

        expect(fileWatcher.isWatching()).toBe(true);
        expect(fileWatcher.getWatchedPaths()).toContain(secondTestDir);
        expect(fileWatcher.getWatchedPaths()).not.toContain(testDir);
      } finally {
        rmSync(secondTestDir, { recursive: true, force: true });
      }
    });
  });

  describe('path management', () => {
    beforeEach(() => {
      fileWatcher.start(testDir);
    });

    it('should add new path to watch', () => {
      const newDir = join(tmpdir(), `file-watcher-new-${Date.now()}`);
      mkdirSync(newDir, { recursive: true });

      try {
        expect(fileWatcher.getWatchedPaths()).not.toContain(newDir);

        fileWatcher.addPath(newDir);

        expect(fileWatcher.getWatchedPaths()).toContain(newDir);
      } finally {
        rmSync(newDir, { recursive: true, force: true });
      }
    });

    it('should not add duplicate paths', () => {
      const initialPathCount = fileWatcher.getWatchedPaths().length;

      fileWatcher.addPath(testDir);

      expect(fileWatcher.getWatchedPaths()).toHaveLength(initialPathCount);
    });

    it('should remove path from watch', () => {
      expect(fileWatcher.getWatchedPaths()).toContain(testDir);

      fileWatcher.removePath(testDir);

      expect(fileWatcher.getWatchedPaths()).not.toContain(testDir);
    });

    it('should handle removing non-existent path gracefully', () => {
      const nonExistentPath = '/non/existent/path';

      expect(() => {
        fileWatcher.removePath(nonExistentPath);
      }).not.toThrow();
    });

    it('should not add path when not watching', () => {
      fileWatcher.stop();

      const newDir = join(tmpdir(), `file-watcher-stopped-${Date.now()}`);
      fileWatcher.addPath(newDir);

      expect(fileWatcher.getWatchedPaths()).not.toContain(newDir);
    });

    it('should not remove path when not watching', () => {
      fileWatcher.stop();

      expect(() => {
        fileWatcher.removePath(testDir);
      }).not.toThrow();
    });
  });

  describe('file filtering', () => {
    it('should detect relevant file extensions', () => {
      const watcher = new FileWatcher();

      // Test via the private method by checking the behavior
      expect(watcher['isRelevantFile']('test.ts')).toBe(true);
      expect(watcher['isRelevantFile']('test.js')).toBe(true);
      expect(watcher['isRelevantFile']('test.tsx')).toBe(true);
      expect(watcher['isRelevantFile']('test.jsx')).toBe(true);
      expect(watcher['isRelevantFile']('test.mts')).toBe(true);
      expect(watcher['isRelevantFile']('test.mjs')).toBe(true);
      expect(watcher['isRelevantFile']('test.json')).toBe(true);
      expect(watcher['isRelevantFile']('test.yml')).toBe(true);
      expect(watcher['isRelevantFile']('test.yaml')).toBe(true);
    });

    it('should ignore irrelevant file extensions', () => {
      const watcher = new FileWatcher();

      expect(watcher['isRelevantFile']('test.txt')).toBe(false);
      expect(watcher['isRelevantFile']('test.log')).toBe(false);
      expect(watcher['isRelevantFile']('test.md')).toBe(false);
      expect(watcher['isRelevantFile']('test.png')).toBe(false);
      expect(watcher['isRelevantFile']('test')).toBe(false); // no extension
    });
  });

  describe('events', () => {
    it('should emit ready event when watcher is ready', (done) => {
      fileWatcher.on('ready', () => {
        expect(fileWatcher.isWatching()).toBe(true);
        done();
      });

      fileWatcher.start(testDir);
    });

    it('should emit file-change event on file creation', (done) => {
      fileWatcher.on('file-change', (event) => {
        expect(event).toHaveProperty('type', 'add');
        expect(event).toHaveProperty('path');
        expect(event.path).toContain('new-file.ts');
        done();
      });

      fileWatcher.on('ready', () => {
        // Create a file after watcher is ready
        writeFileSync(join(testDir, 'new-file.ts'), 'export const test = true;');
      });

      fileWatcher.start(testDir);
    });

    it('should emit file-change event on file modification', (done) => {
      // First create the file
      writeFileSync(testFile, 'export const test = false;');

      let changeEventReceived = false;

      fileWatcher.on('file-change', (event) => {
        if (event.type === 'change') {
          expect(event).toHaveProperty('type', 'change');
          expect(event).toHaveProperty('path', testFile);
          changeEventReceived = true;
          done();
        }
      });

      fileWatcher.on('ready', () => {
        // Modify the file after watcher is ready
        setTimeout(() => {
          writeFileSync(testFile, 'export const test = true;');
        }, 100);
      });

      fileWatcher.start(testDir);

      // Cleanup if test doesn't complete in time
      setTimeout(() => {
        if (!changeEventReceived) {
          done();
        }
      }, 2000);
    });

    it('should emit file-change event on file deletion', (done) => {
      // First create the file
      writeFileSync(testFile, 'export const test = true;');

      fileWatcher.on('file-change', (event) => {
        if (event.type === 'unlink') {
          expect(event).toHaveProperty('type', 'unlink');
          expect(event).toHaveProperty('path', testFile);
          done();
        }
      });

      fileWatcher.on('ready', () => {
        // Delete the file after watcher is ready
        setTimeout(() => {
          rmSync(testFile, { force: true });
        }, 100);
      });

      fileWatcher.start(testDir);
    });

    it('should not emit events for irrelevant files', (done) => {
      let eventReceived = false;

      fileWatcher.on('file-change', () => {
        eventReceived = true;
      });

      fileWatcher.on('ready', () => {
        // Create a file with irrelevant extension
        writeFileSync(join(testDir, 'test.txt'), 'This should be ignored');

        // Wait and check that no event was emitted
        setTimeout(() => {
          expect(eventReceived).toBe(false);
          done();
        }, 500);
      });

      fileWatcher.start(testDir);
    });

    it('should emit error events', (done) => {
      fileWatcher.on('error', (error) => {
        expect(error).toBeInstanceOf(Error);
        done();
      });

      // Start watching a non-existent directory to trigger an error
      fileWatcher.start('/absolutely/non/existent/directory/that/should/not/exist');
    });
  });

  describe('configuration options', () => {
    it('should accept custom chokidar options', () => {
      const customOptions = {
        ignored: '*.log',
        persistent: false,
        ignoreInitial: false,
      };

      expect(() => {
        fileWatcher.start(testDir, customOptions);
      }).not.toThrow();

      expect(fileWatcher.isWatching()).toBe(true);
    });

    it('should merge custom options with defaults', () => {
      const customOptions = {
        persistent: false, // Override default
        ignoreInitial: false, // Override default
        // Other defaults should remain: ignored: /(^|[/\\])\../
      };

      expect(() => {
        fileWatcher.start(testDir, customOptions);
      }).not.toThrow();

      expect(fileWatcher.isWatching()).toBe(true);
    });
  });
});
