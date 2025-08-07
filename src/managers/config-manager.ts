import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import { Logger } from '../utils/logger';
import {
  LocalRunnerConfig,
  ConfigManager as IConfigManager,
  ValidationResult
} from '../interfaces';

export class ConfigManager implements IConfigManager {
  private logger: Logger;
  private defaultConfig: LocalRunnerConfig;

  constructor(logger: Logger) {
    this.logger = logger;
    this.defaultConfig = this.getDefaultConfig();
  }

  /**
   * デフォルト設定を取得
   */
  getDefaultConfig(): LocalRunnerConfig {
    return {
      docker: {
        defaultImage: 'atlassian/default-image:latest',
        networkName: 'bbpl-network',
        volumePrefix: 'bbpl',
        socketPath: '/var/run/docker.sock',
        resourceLimits: {
          memory: {
            '1x': '4g',
            '2x': '8g',
            '4x': '16g',
            '8x': '32g',
            '16x': '64g'
          },
          cpu: {
            '1x': '2',
            '2x': '4',
            '4x': '8',
            '8x': '16',
            '16x': '32'
          }
        }
      },
      cache: {
        name: 'cache',
        path: path.join(os.homedir(), '.bitbucket-pipelines-local', 'cache')
      },
      artifacts: {
        baseDir: path.join(os.homedir(), '.bitbucket-pipelines-local', 'artifacts'),
        enabled: true
      },
      logging: {
        level: 'info',
        format: 'text',
        showDockerCommands: false,
        showTimestamps: true
      },
      environment: {
        bitbucketVariables: {
          BITBUCKET_WORKSPACE: 'local-workspace',
          BITBUCKET_REPO_SLUG: 'local-repo',
          BITBUCKET_REPO_UUID: '{00000000-0000-0000-0000-000000000000}',
          BITBUCKET_BUILD_NUMBER: '1',
          BITBUCKET_COMMIT: 'local-commit',
          BITBUCKET_BRANCH: 'local',
          BITBUCKET_TAG: '',
          BITBUCKET_BOOKMARK: '',
          BITBUCKET_PR_ID: '',
          BITBUCKET_PR_DESTINATION_BRANCH: '',
          BITBUCKET_DEPLOYMENT_ENVIRONMENT: '',
          BITBUCKET_STEP_UUID: '',
          BITBUCKET_STEP_TRIGGERER_UUID: ''
        }
      }
    };
  }

  /**
   * 設定ファイルを読み込み、マージした設定を返す
   */
  async loadConfig(projectDir: string): Promise<LocalRunnerConfig> {
    const configs: Partial<LocalRunnerConfig>[] = [this.defaultConfig];

    // グローバル設定ファイルを読み込み
    const globalConfigPath = path.join(os.homedir(), '.bitbucket-pipelines-local', 'config.yml');
    const globalConfig = await this.loadConfigFile(globalConfigPath);
    if (globalConfig) {
      configs.push(globalConfig);
      this.logger.configLoaded(globalConfigPath);
    }

    // プロジェクト設定ファイルを読み込み
    const projectConfigPath = path.join(projectDir, '.bitbucket-pipelines-local.yml');
    const projectConfig = await this.loadConfigFile(projectConfigPath);
    if (projectConfig) {
      configs.push(projectConfig);
      this.logger.configLoaded(projectConfigPath);
    }

    // 環境変数から設定を読み込み
    const envConfig = this.loadConfigFromEnv();
    if (Object.keys(envConfig).length > 0) {
      configs.push(envConfig);
      this.logger.debug('Configuration loaded from environment variables');
    }

    // 設定をマージ
    const mergedConfig = this.mergeConfigs(...configs);

    // バリデーション
    const validation = this.validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    // 警告があれば表示
    validation.warnings.forEach(warning => {
      this.logger.validationWarning(warning.path, warning.message);
    });

    return mergedConfig;
  }

  /**
   * 設定ファイルの初期化
   */
  async initializeConfig(projectDir: string): Promise<void> {
    const configPath = path.join(projectDir, '.bitbucket-pipelines-local.yml');

    // 既存の設定ファイルがあるかチェック
    try {
      await fs.access(configPath);
      this.logger.warning(`Configuration file already exists: ${configPath}`);
      return;
    } catch {
      // ファイルが存在しない場合は作成
    }

    const sampleConfig: Partial<LocalRunnerConfig> = {
      docker: {
        defaultImage: 'atlassian/default-image:latest',
        registry: {
          url: 'https://index.docker.io/v1/',
          // username: 'your-username',
          // password: 'your-password'
        }
      },
      logging: {
        level: 'info',
        format: 'text',
        showDockerCommands: false,
        showTimestamps: true
      },
      environment: {
        bitbucketVariables: {
          BITBUCKET_WORKSPACE: 'my-workspace',
          BITBUCKET_REPO_SLUG: 'my-repo'
        }
      }
    };

    const yamlContent = YAML.stringify(sampleConfig, {
      indent: 2,
      lineWidth: 120
    });

    const header = `# Bitbucket Pipelines Local Runner Configuration
# This file allows you to customize the local runner behavior
# Documentation: https://github.com/yohi/BitbucketPipelinesLocalRunner

`;

    await fs.writeFile(configPath, header + yamlContent, 'utf8');
    this.logger.info(`Configuration file created: ${configPath}`);
  }

  /**
   * 複数の設定をマージ
   */
  mergeConfigs(...configs: Partial<LocalRunnerConfig>[]): LocalRunnerConfig {
    const baseConfig = this.getDefaultConfig();
    return configs.reduce<LocalRunnerConfig>((merged, config) => {
      return this.deepMerge(merged, config) as LocalRunnerConfig;
    }, baseConfig);
  }

  /**
   * 設定をバリデーション
   */
  validateConfig(config: LocalRunnerConfig): ValidationResult {
    const errors: any[] = [];
    const warnings: any[] = [];

    // Docker設定のバリデーション
    if (config.docker) {
      if (config.docker.resourceLimits) {
        const { memory, cpu } = config.docker.resourceLimits;

        // メモリ制限の検証
        Object.entries(memory).forEach(([size, limit]) => {
          if (!this.isValidMemoryLimit(limit)) {
            errors.push({
              path: `docker.resourceLimits.memory.${size}`,
              message: `Invalid memory limit: ${limit}`,
              type: 'format'
            });
          }
        });

        // CPU制限の検証
        Object.entries(cpu).forEach(([size, limit]) => {
          if (!this.isValidCpuLimit(limit)) {
            errors.push({
              path: `docker.resourceLimits.cpu.${size}`,
              message: `Invalid CPU limit: ${limit}`,
              type: 'format'
            });
          }
        });
      }
    }

    // ログ設定のバリデーション
    if (config.logging) {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLevels.includes(config.logging.level)) {
        errors.push({
          path: 'logging.level',
          message: `Invalid log level: ${config.logging.level}. Must be one of: ${validLevels.join(', ')}`,
          type: 'constraint'
        });
      }

      const validFormats = ['text', 'json'];
      if (!validFormats.includes(config.logging.format)) {
        errors.push({
          path: 'logging.format',
          message: `Invalid log format: ${config.logging.format}. Must be one of: ${validFormats.join(', ')}`,
          type: 'constraint'
        });
      }
    }

    // ディレクトリパスの検証
    if (config.cache && !path.isAbsolute(config.cache.path)) {
      warnings.push({
        path: 'cache.path',
        message: 'Relative cache path may cause issues across different working directories',
        type: 'best-practice'
      });
    }

    if (config.artifacts && !path.isAbsolute(config.artifacts.baseDir)) {
      warnings.push({
        path: 'artifacts.baseDir',
        message: 'Relative artifacts path may cause issues across different working directories',
        type: 'best-practice'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 設定ファイルを読み込み
   */
  private async loadConfigFile(filePath: string): Promise<Partial<LocalRunnerConfig> | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return YAML.parse(content) as Partial<LocalRunnerConfig>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`Failed to load config file: ${filePath}`, error);
      }
      return null;
    }
  }

  /**
   * 環境変数から設定を読み込み
   */
  private loadConfigFromEnv(): Partial<LocalRunnerConfig> {
    const config: Partial<LocalRunnerConfig> = {};

    // BBPL_* 環境変数を処理
    Object.entries(process.env).forEach(([key, value]) => {
      if (!key.startsWith('BBPL_') || !value) {
        return;
      }

      const configKey = key.substring(5).toLowerCase();

      switch (configKey) {
        case 'log_level':
          if (['debug', 'info', 'warn', 'error'].includes(value)) {
            config.logging = {
              level: value as 'debug' | 'info' | 'warn' | 'error',
              format: 'text',
              showDockerCommands: false,
              showTimestamps: true
            };
          }
          break;
        case 'docker_image':
          config.docker = {
            ...this.getDefaultConfig().docker,
            defaultImage: value
          };
          break;
        case 'verbose':
          if (value.toLowerCase() === 'true') {
            config.logging = {
              level: 'debug',
              format: 'text',
              showDockerCommands: false,
              showTimestamps: true
            };
          }
          break;
      }
    });

    return config;
  }

  /**
   * オブジェクトの深いマージ
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    Object.keys(source).forEach(key => {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    });

    return result;
  }

  /**
   * メモリ制限の妥当性確認
   */
  private isValidMemoryLimit(limit: string): boolean {
    return /^\d+[kmg]?$/i.test(limit);
  }

  /**
   * CPU制限の妥当性確認
   */
  private isValidCpuLimit(limit: string): boolean {
    const num = parseFloat(limit);
    return !isNaN(num) && num > 0 && num <= 64;
  }
}
