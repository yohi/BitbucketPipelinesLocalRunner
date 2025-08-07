import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import tar from 'tar';
import { Logger } from '../utils/logger';
import {
  CacheManager as ICacheManager,
  CacheConfig,
  PipelineError,
  ErrorType
} from '../interfaces';

export class CacheManager implements ICacheManager {
  private config: CacheConfig;
  private logger: Logger;
  private cacheMetadata: Map<string, CacheMetadata> = new Map();

  constructor(config: CacheConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * キャッシュパスを取得
   */
  getCachePath(cacheName: string): string {
    return path.join(this.config.path, `${cacheName}.tar.gz`);
  }

  /**
   * キャッシュを復元
   */
  async restoreCache(cacheName: string, targetPath: string): Promise<boolean> {
    try {
      const cacheFilePath = this.getCachePath(cacheName);

      // キャッシュファイルの存在確認
      try {
        await fs.access(cacheFilePath);
      } catch {
        this.logger.debug(`Cache file not found: ${cacheName}`);
        return false;
      }

      // ターゲットディレクトリを作成
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });

      this.logger.debug(`Restoring cache: ${cacheName} to ${targetPath}`);

      // キャッシュを展開
      await tar.extract({
        file: cacheFilePath,
        cwd: targetDir,
        strip: 0
      });

      // メタデータを更新
      const metadata = await this.getCacheMetadata(cacheName);
      if (metadata) {
        metadata.lastAccessed = new Date();
        this.cacheMetadata.set(cacheName, metadata);
        await this.saveCacheMetadata();
      }

      this.logger.debug(`Cache restored successfully: ${cacheName}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to restore cache ${cacheName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * キャッシュを保存
   */
  async saveCache(cacheName: string, sourcePath: string): Promise<void> {
    try {
      // ソースパスの存在確認
      try {
        await fs.access(sourcePath);
      } catch {
        this.logger.debug(`Source path does not exist, skipping cache save: ${sourcePath}`);
        return;
      }

      // キャッシュディレクトリを作成
      await fs.mkdir(this.config.path, { recursive: true });

      const cacheFilePath = this.getCachePath(cacheName);
      const tempCacheFilePath = `${cacheFilePath}.tmp`;

      this.logger.debug(`Saving cache: ${cacheName} from ${sourcePath}`);

      // ソースディレクトリをアーカイブ
      await tar.create({
        file: tempCacheFilePath,
        cwd: path.dirname(sourcePath),
        gzip: true,
        portable: true,
        noMtime: false
      }, [path.basename(sourcePath)]);

      // 一時ファイルを最終的な場所に移動
      await fs.rename(tempCacheFilePath, cacheFilePath);

      // メタデータを保存
      const stats = await fs.stat(cacheFilePath);
      const hash = await this.calculateFileHash(cacheFilePath);

      const metadata: CacheMetadata = {
        name: cacheName,
        size: stats.size,
        created: new Date(),
        lastAccessed: new Date(),
        hash,
        sourceHash: await this.calculateDirectoryHash(sourcePath)
      };

      this.cacheMetadata.set(cacheName, metadata);
      await this.saveCacheMetadata();

      this.logger.debug(`Cache saved successfully: ${cacheName} (${this.formatBytes(stats.size)})`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to save cache ${cacheName}: ${message}`);
      throw new PipelineError(ErrorType.FILE_SYSTEM_ERROR, `Failed to save cache: ${message}`, error);
    }
  }

  /**
   * キャッシュをクリア
   */
  async clearCache(cacheName?: string): Promise<void> {
    try {
      if (cacheName) {
        // 特定のキャッシュをクリア
        const cacheFilePath = this.getCachePath(cacheName);

        try {
          await fs.unlink(cacheFilePath);
          this.logger.debug(`Cache cleared: ${cacheName}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }

        this.cacheMetadata.delete(cacheName);
      } else {
        // すべてのキャッシュをクリア
        try {
          const files = await fs.readdir(this.config.path);

          for (const file of files) {
            if (file.endsWith('.tar.gz')) {
              await fs.unlink(path.join(this.config.path, file));
            }
          }

          this.logger.debug(`All caches cleared from: ${this.config.path}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }

        this.cacheMetadata.clear();
      }

      await this.saveCacheMetadata();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to clear cache: ${message}`);
      throw new PipelineError(ErrorType.FILE_SYSTEM_ERROR, `Failed to clear cache: ${message}`, error);
    }
  }

  /**
   * キャッシュ一覧を取得
   */
  async listCaches(): Promise<string[]> {
    try {
      const cacheFiles = await fs.readdir(this.config.path);
      return cacheFiles
        .filter(file => file.endsWith('.tar.gz'))
        .map(file => file.replace('.tar.gz', ''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * キャッシュ統計情報を取得
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const caches = await this.listCaches();
      let totalSize = 0;
      let oldestCache: Date | null = null;
      let newestCache: Date | null = null;

      for (const cacheName of caches) {
        const metadata = await this.getCacheMetadata(cacheName);
        if (metadata) {
          totalSize += metadata.size;

          if (!oldestCache || metadata.created < oldestCache) {
            oldestCache = metadata.created;
          }

          if (!newestCache || metadata.created > newestCache) {
            newestCache = metadata.created;
          }
        }
      }

      return {
        totalCaches: caches.length,
        totalSize,
        oldestCache,
        newestCache
      };

    } catch (error) {
      this.logger.error(`Failed to get cache stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        totalCaches: 0,
        totalSize: 0,
        oldestCache: null,
        newestCache: null
      };
    }
  }

  /**
   * 古いキャッシュを清理
   */
  async cleanupOldCaches(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const caches = await this.listCaches();
      const cutoffDate = new Date(Date.now() - maxAge);
      let cleanedCount = 0;

      for (const cacheName of caches) {
        const metadata = await this.getCacheMetadata(cacheName);

        if (metadata && metadata.lastAccessed < cutoffDate) {
          await this.clearCache(cacheName);
          cleanedCount++;
          this.logger.debug(`Cleaned up old cache: ${cacheName}`);
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`Cleaned up ${cleanedCount} old cache(s)`);
      }

    } catch (error) {
      this.logger.error(`Failed to cleanup old caches: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * キャッシュメタデータを取得
   */
  private async getCacheMetadata(cacheName: string): Promise<CacheMetadata | null> {
    // メモリキャッシュから取得
    if (this.cacheMetadata.has(cacheName)) {
      return this.cacheMetadata.get(cacheName) || null;
    }

    // ファイルから読み込み
    try {
      await this.loadCacheMetadata();
      return this.cacheMetadata.get(cacheName) || null;
    } catch {
      return null;
    }
  }

  /**
   * キャッシュメタデータを保存
   */
  private async saveCacheMetadata(): Promise<void> {
    try {
      const metadataPath = path.join(this.config.path, '.metadata.json');
      const metadata = Object.fromEntries(this.cacheMetadata);

      await fs.mkdir(this.config.path, { recursive: true });
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (error) {
      this.logger.debug(`Failed to save cache metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * キャッシュメタデータを読み込み
   */
  private async loadCacheMetadata(): Promise<void> {
    try {
      const metadataPath = path.join(this.config.path, '.metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      // Dateオブジェクトを復元
      Object.entries(metadata).forEach(([key, value]: [string, any]) => {
        if (value.created) value.created = new Date(value.created);
        if (value.lastAccessed) value.lastAccessed = new Date(value.lastAccessed);
        this.cacheMetadata.set(key, value);
      });

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.debug(`Failed to load cache metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * ファイルのハッシュ値を計算
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * ディレクトリのハッシュ値を計算
   */
  private async calculateDirectoryHash(dirPath: string): Promise<string> {
    try {
      const stats = await fs.stat(dirPath);

      if (stats.isFile()) {
        return this.calculateFileHash(dirPath);
      }

      if (stats.isDirectory()) {
        const hash = crypto.createHash('sha256');
        await this.hashDirectory(dirPath, hash);
        return hash.digest('hex');
      }

      return '';
    } catch {
      return '';
    }
  }

  /**
   * ディレクトリを再帰的にハッシュ
   */
  private async hashDirectory(dirPath: string, hash: crypto.Hash): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of sortedEntries) {
        const fullPath = path.join(dirPath, entry.name);
        hash.update(entry.name);

        if (entry.isDirectory()) {
          await this.hashDirectory(fullPath, hash);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath);
            hash.update(content);
          } catch {
            // ファイル読み込みエラーは無視
          }
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }
  }

  /**
   * バイト数を人間が読みやすい形式に変換
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
}

// メタデータ型定義
interface CacheMetadata {
  name: string;
  size: number;
  created: Date;
  lastAccessed: Date;
  hash: string;
  sourceHash: string;
}

// 統計情報型定義
interface CacheStats {
  totalCaches: number;
  totalSize: number;
  oldestCache: Date | null;
  newestCache: Date | null;
}
