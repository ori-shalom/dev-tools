import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { extname } from 'path';

export type FileChangeEvent = {
  type: 'change' | 'add' | 'unlink';
  path: string;
};

export class FileWatcher extends EventEmitter {
  private watcher?: FSWatcher;
  private watchedPaths = new Set<string>();

  constructor() {
    super();
  }

  start(paths: string | string[], options?: chokidar.WatchOptions): void {
    if (this.watcher) {
      this.stop();
    }

    const watchPaths = Array.isArray(paths) ? paths : [paths];

    this.watcher = chokidar.watch(watchPaths, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      ...options,
    });

    // Track watched paths
    watchPaths.forEach((path) => this.watchedPaths.add(path));

    // Set up event handlers
    this.watcher
      .on('change', (path) => this.onFileChange('change', path))
      .on('add', (path) => this.onFileChange('add', path))
      .on('unlink', (path) => this.onFileChange('unlink', path))
      .on('error', (error) => this.emit('error', error))
      .on('ready', () => this.emit('ready'));
  }

  private onFileChange(type: 'change' | 'add' | 'unlink', path: string): void {
    // Only emit for relevant file types
    if (this.isRelevantFile(path)) {
      this.emit('file-change', { type, path } as FileChangeEvent);
    }
  }

  private isRelevantFile(path: string): boolean {
    const ext = extname(path);
    const relevantExtensions = ['.ts', '.js', '.tsx', '.jsx', '.mts', '.mjs', '.json', '.yml', '.yaml'];
    return relevantExtensions.includes(ext);
  }

  addPath(path: string): void {
    if (this.watcher && !this.watchedPaths.has(path)) {
      this.watcher.add(path);
      this.watchedPaths.add(path);
    }
  }

  removePath(path: string): void {
    if (this.watcher && this.watchedPaths.has(path)) {
      this.watcher.unwatch(path);
      this.watchedPaths.delete(path);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.watchedPaths.clear();
  }

  isWatching(): boolean {
    return !!this.watcher;
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths);
  }
}
