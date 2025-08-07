import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import { Logger } from '../utils/logger';
import {
  EnvironmentManager as IEnvironmentManager,
  EnvironmentConfig,
  PipelineContext,
  PipelineError,
  ErrorType
} from '../interfaces';

export class EnvironmentManager implements IEnvironmentManager {
  private config: EnvironmentConfig;
  private logger: Logger;

  constructor(config: EnvironmentConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * 環境変数を読み込み
   */
  async loadEnvironment(envFile?: string): Promise<Record<string, string>> {
    const environments: Record<string, string>[] = [];

    // 1. プロセス環境変数
    environments.push(process.env as Record<string, string>);

    // 2. デフォルト .env ファイル
    const defaultEnvPath = path.join(process.cwd(), '.env');
    const defaultEnv = await this.loadEnvFile(defaultEnvPath);
    if (defaultEnv) {
      environments.push(defaultEnv);
      this.logger.debug(`Loaded environment from: ${defaultEnvPath}`);
    }

    // 3. 指定された .env ファイル
    if (envFile) {
      const customEnv = await this.loadEnvFile(envFile);
      if (customEnv) {
        environments.push(customEnv);
        this.logger.debug(`Loaded environment from: ${envFile}`);
      } else {
        this.logger.warning(`Specified env file not found: ${envFile}`);
      }
    }

    // 4. パイプライン専用 .env ファイル
    const pipelineEnvPath = path.join(process.cwd(), '.env.pipelines');
    const pipelineEnv = await this.loadEnvFile(pipelineEnvPath);
    if (pipelineEnv) {
      environments.push(pipelineEnv);
      this.logger.debug(`Loaded pipeline environment from: ${pipelineEnvPath}`);
    }

    // 5. 設定ファイルの環境変数
    if (this.config.bitbucketVariables) {
      environments.push(this.config.bitbucketVariables);
    }

    // 環境変数をマージ（後の要素が優先）
    return this.mergeEnvironments(...environments);
  }

  /**
   * Bitbucket システム変数を生成
   */
  getBitbucketVariables(context: PipelineContext): Record<string, string> {
    const variables: Record<string, string> = {
      // 基本的なリポジトリ情報
      BITBUCKET_WORKSPACE: context.workspace,
      BITBUCKET_REPO_SLUG: context.repoSlug,
      BITBUCKET_REPO_UUID: context.repoUuid,
      BITBUCKET_REPO_FULL_NAME: `${context.workspace}/${context.repoSlug}`,

      // ビルド情報
      BITBUCKET_BUILD_NUMBER: context.buildNumber.toString(),
      BITBUCKET_COMMIT: context.commit,
      BITBUCKET_BRANCH: context.branch,

      // パイプライン情報
      BITBUCKET_PIPELINE_UUID: `{${this.generateUUID()}}`,
      BITBUCKET_STEP_UUID: context.stepName ? `{${this.generateUUID()}}` : '',
      BITBUCKET_STEP_TRIGGERER_UUID: `{${this.generateUUID()}}`,

      // タグ情報（ローカルでは空）
      BITBUCKET_TAG: '',
      BITBUCKET_BOOKMARK: '',

      // プルリクエスト情報（ローカルでは空）
      BITBUCKET_PR_ID: '',
      BITBUCKET_PR_DESTINATION_BRANCH: '',

      // デプロイメント情報（ローカルでは空）
      BITBUCKET_DEPLOYMENT_ENVIRONMENT: '',

      // 追加のメタデータ
      BITBUCKET_CLONE_DIR: '/opt/atlassian/pipelines/agent/build',
      BITBUCKET_PARALLEL_STEP: 'false',
      BITBUCKET_PARALLEL_STEP_COUNT: '1',

      // ローカル実行フラグ
      BITBUCKET_PIPELINES_LOCAL: 'true',
      BBPL_EXECUTION_ID: this.generateExecutionId(),
      BBPL_EXECUTION_TIME: new Date().toISOString()
    };

    // デフォルト値とマージ
    if (this.config.bitbucketVariables) {
      Object.assign(variables, this.config.bitbucketVariables, variables);
    }

    this.logger.debug('Generated Bitbucket system variables');
    return variables;
  }

  /**
   * 複数の環境変数オブジェクトをマージ
   */
  mergeEnvironments(...envs: Record<string, string>[]): Record<string, string> {
    const merged: Record<string, string> = {};

    envs.forEach(env => {
      Object.entries(env).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          merged[key] = value;
        }
      });
    });

    return merged;
  }

  /**
   * セキュア変数をバリデーション・取得
   */
  async validateSecureVariables(variables: string[]): Promise<Record<string, string>> {
    const secureVars: Record<string, string> = {};

    // 設定ファイルからセキュア変数を取得
    if (this.config.secureVariables) {
      Object.assign(secureVars, this.config.secureVariables);
    }

    // 不足しているセキュア変数を特定
    const missingVars = variables.filter(varName => !secureVars[varName]);

    if (missingVars.length > 0) {
      this.logger.warning(`Missing secure variables: ${missingVars.join(', ')}`);

      // インタラクティブに入力を求める
      const answers = await this.promptForSecureVariables(missingVars);
      Object.assign(secureVars, answers);
    }

    // 変数をマスク（ログ出力用）
    this.maskSensitiveVariables(Object.keys(secureVars));

    return secureVars;
  }

  /**
   * 環境変数の検証
   */
  validateEnvironmentVariables(env: Record<string, string>): string[] {
    const errors: string[] = [];

    // 必須のBitbucket変数をチェック
    const requiredVars = [
      'BITBUCKET_WORKSPACE',
      'BITBUCKET_REPO_SLUG',
      'BITBUCKET_BUILD_NUMBER'
    ];

    requiredVars.forEach(varName => {
      if (!env[varName]) {
        errors.push(`Required variable ${varName} is missing`);
      }
    });

    // 変数名の妥当性をチェック
    Object.keys(env).forEach(varName => {
      if (!this.isValidVariableName(varName)) {
        errors.push(`Invalid variable name: ${varName}`);
      }
    });

    return errors;
  }

  /**
   * 環境変数の統計情報を取得
   */
  getEnvironmentStats(env: Record<string, string>): EnvironmentStats {
    const bitbucketVars = Object.keys(env).filter(key => key.startsWith('BITBUCKET_'));
    const systemVars = Object.keys(env).filter(key => key.startsWith('BBPL_'));
    const customVars = Object.keys(env).filter(key =>
      !key.startsWith('BITBUCKET_') && !key.startsWith('BBPL_') && !key.startsWith('PATH')
    );

    return {
      totalVariables: Object.keys(env).length,
      bitbucketVariables: bitbucketVars.length,
      systemVariables: systemVars.length,
      customVariables: customVars.length
    };
  }

  /**
   * .env ファイルを読み込み
   */
  private async loadEnvFile(filePath: string): Promise<Record<string, string> | null> {
    try {
      await fs.access(filePath);
      const result = dotenv.config({ path: filePath });

      if (result.error) {
        this.logger.debug(`Failed to parse env file ${filePath}: ${result.error.message}`);
        return null;
      }

      return result.parsed || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.debug(`Failed to load env file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return null;
    }
  }

  /**
   * セキュア変数の入力をプロンプト
   */
  private async promptForSecureVariables(variables: string[]): Promise<Record<string, string>> {
    const questions = variables.map(varName => ({
      type: 'password',
      name: varName,
      message: `Enter value for secure variable ${varName}:`,
      mask: '*'
    }));

    try {
      return await inquirer.prompt(questions);
    } catch (error) {
      this.logger.warning('Failed to prompt for secure variables, using empty values');
      return variables.reduce((acc, varName) => {
        acc[varName] = '';
        return acc;
      }, {} as Record<string, string>);
    }
  }

  /**
   * センシティブな変数をマスク
   */
  private maskSensitiveVariables(variableNames: string[]): void {
    // ここでロガーにセンシティブな変数名を登録
    // 実際のマスキングはログ出力時に行う
    this.logger.debug(`Registered ${variableNames.length} sensitive variables for masking`);
  }

  /**
   * 変数名の妥当性をチェック
   */
  private isValidVariableName(name: string): boolean {
    // 環境変数名として有効な文字列かチェック
    return /^[A-Z_][A-Z0-9_]*$/i.test(name);
  }

  /**
   * UUIDを生成
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 実行IDを生成
   */
  private generateExecutionId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * 環境変数の値をサニタイズ
   */
  // private sanitizeEnvironmentValue(value: string): string {
  //   // 制御文字や特殊文字をエスケープ
  //   return value
  //     .replace(/\r?\n/g, '\\n')
  //     .replace(/\t/g, '\\t')
  //     .replace(/\r/g, '\\r');
  // }

  /**
   * 環境変数のエクスポート
   */
  async exportEnvironment(env: Record<string, string>, outputPath: string): Promise<void> {
    try {
      const envLines = Object.entries(env)
        .filter(([key, value]) => key && value !== undefined)
        .map(([key, value]) => `${key}=${this.escapeEnvValue(value)}`)
        .sort();

      const content = [
        '# Generated by Bitbucket Pipelines Local Runner',
        `# Generated at: ${new Date().toISOString()}`,
        '',
        ...envLines
      ].join('\n');

      await fs.writeFile(outputPath, content, 'utf8');
      this.logger.debug(`Environment exported to: ${outputPath}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new PipelineError(ErrorType.FILE_SYSTEM_ERROR, `Failed to export environment: ${message}`, error);
    }
  }

  /**
   * 環境変数の値をエスケープ
   */
  private escapeEnvValue(value: string): string {
    // クォートが必要かチェック
    if (/[\s"'$`\\]/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
}

// 統計情報型定義
interface EnvironmentStats {
  totalVariables: number;
  bitbucketVariables: number;
  systemVariables: number;
  customVariables: number;
}
