import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
// import tar from 'tar';  // 将来的にアーカイブ機能で使用予定
import { Logger } from '../utils/logger';
import {
  ArtifactManager as IArtifactManager,
  ArtifactConfigLocal,
  PipelineError,
  ErrorType
} from '../interfaces';

export class ArtifactManager implements IArtifactManager {
  private config: ArtifactConfigLocal;
  private logger: Logger;

  constructor(config: ArtifactConfigLocal, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * アーティファクトを保存
   */
  async saveArtifacts(patterns: string[], sourceDir: string, stepName: string): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Artifacts are disabled');
      return;
    }

    try {
      const stepArtifactsDir = path.join(this.config.baseDir, this.sanitizeStepName(stepName));
      await fs.mkdir(stepArtifactsDir, { recursive: true });

      let totalFiles = 0;
      const collectedFiles: string[] = [];

      for (const pattern of patterns) {
        this.logger.debug(`Collecting artifacts with pattern: ${pattern}`);

        // globパターンでファイルを検索
        const files = await this.findFilesWithPattern(pattern, sourceDir);

        this.logger.debug(`Found ${files.length} files for pattern: ${pattern}`);

        for (const file of files) {
          const relativePath = path.relative(sourceDir, file);
          const targetPath = path.join(stepArtifactsDir, relativePath);

          // ターゲットディレクトリを作成
          await fs.mkdir(path.dirname(targetPath), { recursive: true });

          // ファイルをコピー
          await fs.copyFile(file, targetPath);
          collectedFiles.push(relativePath);
          totalFiles++;
        }
      }

      // アーティファクトメタデータを保存
      const metadata: ArtifactMetadata = {
        stepName,
        timestamp: new Date(),
        patterns,
        files: collectedFiles,
        totalSize: await this.calculateDirectorySize(stepArtifactsDir)
      };

      await this.saveArtifactMetadata(stepName, metadata);

      this.logger.artifactsSaved(totalFiles);
      this.logger.debug(`Artifacts saved to: ${stepArtifactsDir}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to save artifacts: ${message}`);
      throw new PipelineError(ErrorType.FILE_SYSTEM_ERROR, `Failed to save artifacts: ${message}`, error);
    }
  }

  /**
   * アーティファクトを復元
   */
  async restoreArtifacts(targetDir: string, stepName?: string): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Artifacts are disabled');
      return;
    }

    try {
      let totalFiles = 0;

      if (stepName) {
        // 特定のステップのアーティファクトを復元
        const restored = await this.restoreStepArtifacts(stepName, targetDir);
        totalFiles += restored;
      } else {
        // 利用可能なすべてのステップのアーティファクトを復元
        const availableSteps = await this.listAvailableSteps();

        for (const step of availableSteps) {
          const restored = await this.restoreStepArtifacts(step, targetDir);
          totalFiles += restored;
        }
      }

      if (totalFiles > 0) {
        this.logger.artifactsRestored(totalFiles);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to restore artifacts: ${message}`);
      // 復元失敗は致命的でないので例外をスローしない
    }
  }

  /**
   * アーティファクト一覧を取得
   */
  async listArtifacts(stepName?: string): Promise<string[]> {
    try {
      if (stepName) {
        const stepArtifactsDir = path.join(this.config.baseDir, this.sanitizeStepName(stepName));
        return this.getFilesInDirectory(stepArtifactsDir);
      } else {
        const allFiles: string[] = [];
        const availableSteps = await this.listAvailableSteps();

        for (const step of availableSteps) {
          const stepFiles = await this.listArtifacts(step);
          allFiles.push(...stepFiles.map(file => `${step}/${file}`));
        }

        return allFiles;
      }
    } catch (error) {
      this.logger.error(`Failed to list artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * アーティファクトをクリア
   */
  async clearArtifacts(): Promise<void> {
    try {
      // アーティファクトディレクトリが存在するかチェック
      try {
        await fs.access(this.config.baseDir);
      } catch {
        this.logger.debug('Artifacts directory does not exist');
        return;
      }

      // ディレクトリの中身をすべて削除
      const entries = await fs.readdir(this.config.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(this.config.baseDir, entry.name);

        if (entry.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }

      this.logger.debug(`Artifacts cleared from: ${this.config.baseDir}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to clear artifacts: ${message}`);
      throw new PipelineError(ErrorType.FILE_SYSTEM_ERROR, `Failed to clear artifacts: ${message}`, error);
    }
  }

  /**
   * アーティファクト統計情報を取得
   */
  async getArtifactStats(): Promise<ArtifactStats> {
    try {
      const steps = await this.listAvailableSteps();
      let totalFiles = 0;
      let totalSize = 0;

      for (const step of steps) {
        const metadata = await this.loadArtifactMetadata(step);
        if (metadata) {
          totalFiles += metadata.files.length;
          totalSize += metadata.totalSize;
        }
      }

      return {
        totalSteps: steps.length,
        totalFiles,
        totalSize
      };

    } catch (error) {
      this.logger.error(`Failed to get artifact stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        totalSteps: 0,
        totalFiles: 0,
        totalSize: 0
      };
    }
  }

  /**
   * パターンでファイルを検索
   */
  private async findFilesWithPattern(pattern: string, sourceDir: string): Promise<string[]> {
    try {
      // globパターンを実行
      const options = {
        cwd: sourceDir,
        absolute: true,
        nodir: true, // ディレクトリは除外
        dot: false   // 隠しファイルは除外
      };

      const files = await glob(pattern, options);

      // ファイルの存在確認
      const existingFiles: string[] = [];
      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          if (stats.isFile()) {
            existingFiles.push(file);
          }
        } catch {
          // ファイルが存在しない場合は無視
        }
      }

      return existingFiles;

    } catch (error) {
      this.logger.debug(`Failed to find files with pattern ${pattern}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * 特定ステップのアーティファクトを復元
   */
  private async restoreStepArtifacts(stepName: string, targetDir: string): Promise<number> {
    try {
      const stepArtifactsDir = path.join(this.config.baseDir, this.sanitizeStepName(stepName));

      // ステップアーティファクトディレクトリの存在確認
      try {
        await fs.access(stepArtifactsDir);
      } catch {
        return 0; // アーティファクトが存在しない
      }

      let restoredFiles = 0;
      const files = await this.getFilesInDirectory(stepArtifactsDir);

      for (const file of files) {
        const sourcePath = path.join(stepArtifactsDir, file);
        const targetPath = path.join(targetDir, file);

        // ターゲットディレクトリを作成
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        // ファイルをコピー
        await fs.copyFile(sourcePath, targetPath);
        restoredFiles++;
      }

      this.logger.debug(`Restored ${restoredFiles} artifacts from step: ${stepName}`);
      return restoredFiles;

    } catch (error) {
      this.logger.debug(`Failed to restore artifacts from step ${stepName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return 0;
    }
  }

  /**
   * 利用可能なステップ一覧を取得
   */
  private async listAvailableSteps(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.config.baseDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * ディレクトリ内のファイル一覧を再帰的に取得
   */
  private async getFilesInDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (entry.isDirectory()) {
          const subFiles = await this.getFilesInDirectory(fullPath);
          files.push(...subFiles.map(file => path.join(relativePath, file)));
        } else {
          files.push(relativePath);
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }

    return files;
  }

  /**
   * ディレクトリサイズを計算
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else {
          try {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          } catch {
            // ファイル読み込みエラーは無視
          }
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }

    return totalSize;
  }

  /**
   * ステップ名をファイルシステム用にサニタイズ
   */
  private sanitizeStepName(stepName: string): string {
    return stepName
      .replace(/[^a-zA-Z0-9_-]/g, '_')  // 英数字、アンダースコア、ハイフン以外を置換
      .replace(/_{2,}/g, '_')           // 連続するアンダースコアを1つに
      .replace(/^_+|_+$/g, '')         // 先頭・末尾のアンダースコアを除去
      .toLowerCase();
  }

  /**
   * アーティファクトメタデータを保存
   */
  private async saveArtifactMetadata(stepName: string, metadata: ArtifactMetadata): Promise<void> {
    try {
      const metadataPath = path.join(
        this.config.baseDir,
        this.sanitizeStepName(stepName),
        '.metadata.json'
      );

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (error) {
      this.logger.debug(`Failed to save artifact metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * アーティファクトメタデータを読み込み
   */
  private async loadArtifactMetadata(stepName: string): Promise<ArtifactMetadata | null> {
    try {
      const metadataPath = path.join(
        this.config.baseDir,
        this.sanitizeStepName(stepName),
        '.metadata.json'
      );

      const content = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(content);

      // Dateオブジェクトを復元
      if (metadata.timestamp) {
        metadata.timestamp = new Date(metadata.timestamp);
      }

      return metadata;
    } catch {
      return null;
    }
  }
}

// メタデータ型定義
interface ArtifactMetadata {
  stepName: string;
  timestamp: Date;
  patterns: string[];
  files: string[];
  totalSize: number;
}

// 統計情報型定義
interface ArtifactStats {
  totalSteps: number;
  totalFiles: number;
  totalSize: number;
}
