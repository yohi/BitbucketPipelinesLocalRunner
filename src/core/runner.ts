import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import chalk from 'chalk';
import { YAMLParser } from './yaml-parser';
import { PipelineValidator } from './validator';
import { DockerManager } from '../managers/docker-manager';
import { CacheManager } from '../managers/cache-manager';
import { ArtifactManager } from '../managers/artifact-manager';
import { EnvironmentManager } from '../managers/environment-manager';
import { Logger } from '../utils/logger';
import {
  CLICommand,
  CLIOptions,
  LocalRunnerConfig,
  PipelineConfig,
  Pipeline,
  ExecutionOptions,
  ExecutionResult,
  ExecutionContext,
  StepResult,
  Step,
  ParallelSteps,
  PipelineError,
  ErrorType,
  PipelineContext
} from '../interfaces';
import { isStep, isParallelSteps } from '../utils/type-guards';

export class BitbucketPipelinesRunner implements CLICommand {
  private config: LocalRunnerConfig;
  private logger: Logger;
  private yamlParser: YAMLParser;
  private validator: PipelineValidator;
  private dockerManager: DockerManager;
  private cacheManager: CacheManager;
  private artifactManager: ArtifactManager;
  private environmentManager: EnvironmentManager;

  constructor(config: LocalRunnerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.yamlParser = new YAMLParser();
    this.validator = new PipelineValidator();
    this.dockerManager = new DockerManager(config.docker, logger);
    this.cacheManager = new CacheManager(config.cache, logger);
    this.artifactManager = new ArtifactManager(config.artifacts, logger);
    this.environmentManager = new EnvironmentManager(config.environment, logger);
  }

  /**
   * パイプラインを実行
   */
  async run(options: CLIOptions): Promise<void> {
    const startTime = Date.now();

    try {
      // 設定をロード
      this.updateLogLevel(options);

      // pipeline config を解析
      const pipelineConfig = await this.loadPipelineConfig();

      // バリデーション実行
      const validation = this.validator.validate(pipelineConfig);
      if (!validation.valid) {
        validation.errors.forEach(error => {
          this.logger.validationError(error.path, error.message);
        });
        throw new PipelineError(ErrorType.VALIDATION_ERROR, 'Pipeline configuration validation failed');
      }

      // 警告を表示
      validation.warnings.forEach(warning => {
        this.logger.validationWarning(warning.path, warning.message);
      });

      // 実行するパイプラインを選択
      const selectedPipeline = this.selectPipeline(pipelineConfig, options);

      // 実行コンテキストを作成
      const context = await this.createExecutionContext(pipelineConfig, options);

      // 実行オプションを作成
      const executionOptions: ExecutionOptions = {
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        pipeline: options.pipeline,
        branch: options.branch,
        custom: options.custom
      };

      this.logger.info(chalk.blue('🔧 Setting up Docker environment...'));

      // Docker ネットワークを作成
      await this.dockerManager.createNetwork(this.config.docker.networkName || 'bbpl-network');

      this.logger.info(chalk.green('✅ Environment setup complete'));

      // パイプラインを実行
      const result = await this.executePipeline(selectedPipeline, context, executionOptions);

      const duration = Date.now() - startTime;
      this.logger.timing('Total execution time', duration);

      if (!result.success) {
        throw new PipelineError(ErrorType.CONTAINER_ERROR, 'Pipeline execution failed', result.error);
      }

    } catch (error) {
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * パイプライン設定をバリデーション
   */
  async validate(options: CLIOptions): Promise<boolean> {
    try {
      this.updateLogLevel(options);

      const pipelineConfig = await this.loadPipelineConfig();
      const validation = this.validator.validate(pipelineConfig);

      if (!validation.valid) {
        validation.errors.forEach(error => {
          this.logger.validationError(error.path, error.message);
        });
        return false;
      }

      validation.warnings.forEach(warning => {
        this.logger.validationWarning(warning.path, warning.message);
      });

      this.logger.success('Pipeline configuration is valid');
      return true;

    } catch (error) {
      if (error instanceof PipelineError) {
        this.logger.error(error.message);
      } else {
        this.logger.error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return false;
    }
  }

  /**
   * 利用可能なパイプラインをリスト
   */
  async listPipelines(): Promise<string[]> {
    try {
      const pipelineConfig = await this.loadPipelineConfig();
      const pipelines: string[] = [];

      if (pipelineConfig.pipelines.default) {
        pipelines.push('default');
      }

      if (pipelineConfig.pipelines.branches) {
        Object.keys(pipelineConfig.pipelines.branches).forEach(branch => {
          pipelines.push(`branches/${branch}`);
        });
      }

      if (pipelineConfig.pipelines.custom) {
        Object.keys(pipelineConfig.pipelines.custom).forEach(custom => {
          pipelines.push(`custom/${custom}`);
        });
      }

      if (pipelineConfig.pipelines.tags) {
        Object.keys(pipelineConfig.pipelines.tags).forEach(tag => {
          pipelines.push(`tags/${tag}`);
        });
      }

      return pipelines;

    } catch (error) {
      this.logger.error(`Failed to list pipelines: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * キャッシュをクリア
   */
  async clearCache(options?: { cache?: boolean; artifacts?: boolean }): Promise<void> {
    try {
      const clearCache = options?.cache !== false && (options?.cache === true || (!options?.cache && !options?.artifacts));
      const clearArtifacts = options?.artifacts !== false && (options?.artifacts === true || (!options?.cache && !options?.artifacts));

      if (clearCache) {
        await this.cacheManager.clearCache();
        this.logger.success('Cache cleared');
      }

      if (clearArtifacts) {
        await this.artifactManager.clearArtifacts();
        this.logger.success('Artifacts cleared');
      }

      if (!clearCache && !clearArtifacts) {
        this.logger.info('Nothing to clear - no options specified');
      }
    } catch (error) {
      this.logger.error(`Failed to clear cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * パイプライン設定ファイルをロード
   */
  private async loadPipelineConfig(): Promise<PipelineConfig> {
    const configPath = path.join(process.cwd(), 'bitbucket-pipelines.yml');

    try {
      await fs.access(configPath);
    } catch {
      throw new PipelineError(
        ErrorType.FILE_SYSTEM_ERROR,
        `Pipeline configuration file not found: ${configPath}`
      );
    }

    return this.yamlParser.parseFile(configPath);
  }

  /**
   * 実行するパイプラインを選択
   */
  private selectPipeline(config: PipelineConfig, options: CLIOptions): Pipeline {
    // カスタムパイプライン
    if (options.custom) {
      if (!config.pipelines.custom || !config.pipelines.custom[options.custom]) {
        throw new PipelineError(
          ErrorType.VALIDATION_ERROR,
          `Custom pipeline not found: ${options.custom}`
        );
      }
      this.logger.info(chalk.blue(`📋 Selected custom pipeline: ${options.custom}`));
      const pipeline = config.pipelines.custom[options.custom];
      if (!pipeline) {
        throw new PipelineError(
          ErrorType.VALIDATION_ERROR,
          `Custom pipeline not found: ${options.custom}`
        );
      }
      return pipeline;
    }

    // ブランチ指定パイプライン
    if (options.branch) {
      if (!config.pipelines.branches || !config.pipelines.branches[options.branch]) {
        this.logger.warning(`Branch pipeline not found: ${options.branch}, falling back to default`);
        if (!config.pipelines.default) {
          throw new PipelineError(
            ErrorType.VALIDATION_ERROR,
            `No pipeline found for branch ${options.branch} and no default pipeline`
          );
        }
        return config.pipelines.default;
      }
      this.logger.info(chalk.blue(`📋 Selected branch pipeline: ${options.branch}`));
      const pipeline = config.pipelines.branches[options.branch];
      if (!pipeline) {
        throw new PipelineError(
          ErrorType.VALIDATION_ERROR,
          `Branch pipeline not found: ${options.branch}`
        );
      }
      return pipeline;
    }

    // 明示的パイプライン指定
    if (options.pipeline) {
      if (options.pipeline === 'default') {
        if (!config.pipelines.default) {
          throw new PipelineError(ErrorType.VALIDATION_ERROR, 'Default pipeline not found');
        }
        this.logger.info(chalk.blue('📋 Selected default pipeline'));
        return config.pipelines.default;
      }

      // その他の特殊パイプライン名は今後拡張
      throw new PipelineError(
        ErrorType.VALIDATION_ERROR,
        `Unknown pipeline: ${options.pipeline}`
      );
    }

    // デフォルトパイプライン
    if (!config.pipelines.default) {
      throw new PipelineError(ErrorType.VALIDATION_ERROR, 'No default pipeline found');
    }

    this.logger.info(chalk.blue('📋 Selected default pipeline'));
    return config.pipelines.default;
  }

  /**
   * 実行コンテキストを作成
   */
  private async createExecutionContext(_config: PipelineConfig, options: CLIOptions): Promise<ExecutionContext> {
    const workspaceDir = process.cwd();
    const artifactsDir = path.join(this.config.artifacts.baseDir, 'current');
    const cacheDir = this.config.cache.path;

    // 必要なディレクトリを作成
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });

    // パイプラインコンテキストを作成
    const pipelineContext: PipelineContext = {
      branch: options.branch || 'local',
      commit: 'local-commit',
      buildNumber: Date.now(),
      repoName: path.basename(workspaceDir),
      workspace: 'local-workspace',
      repoSlug: path.basename(workspaceDir),
      repoUuid: '{00000000-0000-0000-0000-000000000000}'
    };

    // 環境変数を読み込み
    const environment = await this.environmentManager.loadEnvironment(options.envFile);
    const bitbucketVars = this.environmentManager.getBitbucketVariables(pipelineContext);
    const mergedEnv = this.environmentManager.mergeEnvironments(environment, bitbucketVars);

    return {
      workspaceDir,
      artifactsDir,
      cacheDir,
      environment: mergedEnv,
      services: [],
      network: this.config.docker.networkName || 'bbpl-network'
    };
  }

  /**
   * パイプラインを実行
   */
  private async executePipeline(
    pipeline: Pipeline,
    context: ExecutionContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let success = true;
    let error: Error | undefined;

    try {
      this.logger.info(chalk.blue(`🚀 Starting pipeline execution (${pipeline.length} steps)`));

      for (let i = 0; i < pipeline.length; i++) {
        const pipelineItem = pipeline[i];

        if (isStep(pipelineItem)) {
          this.logger.info(chalk.blue(`📋 Step ${i + 1}/${pipeline.length}`));
          const result = await this.executeStep(pipelineItem, context, options);
          stepResults.push(result);

          if (!result.success) {
            success = false;
            error = result.error;
            break;
          }
        } else if (isParallelSteps(pipelineItem)) {
          this.logger.info(chalk.blue(`📋 Parallel steps ${i + 1}/${pipeline.length} (${pipelineItem.parallel.steps.length} parallel)`));
          const results = await this.executeParallelSteps(pipelineItem, context, options);
          stepResults.push(...results);

          const failedResults = results.filter(r => !r.success);
          if (failedResults.length > 0) {
            success = false;
            error = failedResults[0]?.error;
            break;
          }
        }

        // ステップ間での少し待機
        if (i < pipeline.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

    } catch (err) {
      success = false;
      error = err instanceof Error ? err : new Error('Unknown error');
    }

    const duration = Date.now() - startTime;

    return {
      success,
      steps: stepResults,
      duration,
      error: error || undefined
    };
  }

  /**
   * 単一ステップを実行
   */
  private async executeStep(step: Step, context: ExecutionContext, options: ExecutionOptions): Promise<StepResult> {
    const stepName = step.name || 'Unnamed Step';
    const startTime = Date.now();

    try {
      this.logger.stepStart(stepName);

      if (options.dryRun) {
        this.logger.info(chalk.yellow('📋 Dry run - would execute:'));
        step.script.forEach((command, index) => {
          this.logger.info(chalk.gray(`  ${index + 1}. ${command}`));
        });

        const duration = Date.now() - startTime;
        this.logger.stepComplete(stepName, duration);

        return {
          name: stepName,
          success: true,
          exitCode: 0,
          duration,
          logs: ['Dry run - no actual execution']
        };
      }

      // キャッシュを復元
      if (step.caches) {
        await this.restoreCaches(step.caches, context);
      }

      // 前のステップのアーティファクトを復元
      await this.artifactManager.restoreArtifacts(context.workspaceDir);

      // サービスを開始
      if (step.services) {
        // TODO: サービス開始の実装
        this.logger.info(chalk.blue(`🔧 Services: ${step.services.join(', ')}`));
      }

      // ステップを実行
      const containerResult = await this.dockerManager.runStepContainer(step, context);

      // キャッシュを保存
      if (step.caches) {
        await this.saveCaches(step.caches, context);
      }

      // アーティファクトを保存
      if (step.artifacts) {
        await this.artifactManager.saveArtifacts(
          step.artifacts.paths,
          context.workspaceDir,
          stepName
        );
      }

      const duration = Date.now() - startTime;

      if (containerResult.exitCode === 0) {
        this.logger.stepComplete(stepName, duration);
      } else {
        this.logger.stepFailed(stepName, duration, containerResult.error);
      }

      return {
        name: stepName,
        success: containerResult.exitCode === 0,
        exitCode: containerResult.exitCode,
        duration,
        logs: containerResult.output,
        error: containerResult.error ? new Error(containerResult.error) : undefined
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.stepFailed(stepName, duration, errorMessage);

      return {
        name: stepName,
        success: false,
        exitCode: 1,
        duration,
        logs: [],
        error: error instanceof Error ? error : new Error('Unknown error')
      };
    }
  }

  /**
   * 並列ステップを実行
   */
  private async executeParallelSteps(
    parallelSteps: ParallelSteps,
    context: ExecutionContext,
    options: ExecutionOptions
  ): Promise<StepResult[]> {
    const { steps, failFast } = parallelSteps.parallel;

    this.logger.info(chalk.blue(`🔄 Executing ${steps.length} steps in parallel`));

    if (failFast) {
      this.logger.debug('Fail-fast mode enabled');
    }

    // 並列実行
    const stepPromises = steps.map((step, index) =>
      this.executeStep(step, context, options).catch(error => ({
        name: step.name || `Parallel Step ${index + 1}`,
        success: false,
        exitCode: 1,
        duration: 0,
        logs: [],
        error: error instanceof Error ? error : new Error('Unknown error')
      }))
    );

    if (failFast) {
      // fail-fast: 最初の失敗で即座に停止
      const results: StepResult[] = [];
      
      // レース条件で最初の失敗を検出
      try {
        // 最初の失敗が発生した時点で拒否される
        await Promise.all(stepPromises);
        // 全て成功した場合、結果を収集
        const settledResults = await Promise.allSettled(stepPromises);
        for (const result of settledResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          }
        }
        return results;
      } catch {
        // 失敗が発生した場合、完了した結果のみを収集
        const settledResults = await Promise.allSettled(stepPromises);
        
        for (let i = 0; i < settledResults.length; i++) {
          const result = settledResults[i];
          if (result && result.status === 'fulfilled') {
            results.push(result.value);
          } else if (result && result.status === 'rejected') {
            const step = steps[i];
            results.push({
              name: step?.name || `Parallel Step ${i + 1}`,
              success: false,
              exitCode: 1,
              duration: 0,
              logs: [],
              error: result.reason instanceof Error ? result.reason : new Error('Step execution failed')
            });
          }
        }
        return results;
      }
    } else {
      // 全ステップの完了を待機
      return Promise.all(stepPromises);
    }
  }

  /**
   * キャッシュを復元
   */
  private async restoreCaches(caches: string[], context: ExecutionContext): Promise<void> {
    for (const cacheName of caches) {
      const restored = await this.cacheManager.restoreCache(
        cacheName,
        path.join(context.workspaceDir, this.getCachePath(cacheName))
      );

      if (restored) {
        this.logger.cacheHit(cacheName);
      } else {
        this.logger.cacheMiss(cacheName);
      }
    }
  }

  /**
   * キャッシュを保存
   */
  private async saveCaches(caches: string[], context: ExecutionContext): Promise<void> {
    for (const cacheName of caches) {
      await this.cacheManager.saveCache(
        cacheName,
        path.join(context.workspaceDir, this.getCachePath(cacheName))
      );
      this.logger.cacheSaved(cacheName);
    }
  }

  /**
   * キャッシュのパスを取得
   */
  private getCachePath(cacheName: string): string {
    // 事前定義キャッシュのパスマッピング
    const predefinedCaches: Record<string, string> = {
      node: 'node_modules',
      npm: '~/.npm',
      yarn: '~/.cache/yarn',
      'pip-cache': '~/.cache/pip',
      composer: 'vendor',
      gradle: '~/.gradle/caches',
      maven: '~/.m2/repository',
      docker: '/var/lib/docker'
    };

    const cachePath = predefinedCaches[cacheName] || cacheName;
    
    // '~'を含むパスをホームディレクトリに展開
    if (cachePath.startsWith('~/')) {
      return path.join(os.homedir(), cachePath.slice(2));
    }
    
    return cachePath;
  }

  /**
   * ログレベルを更新
   */
  private updateLogLevel(options: CLIOptions): void {
    if (options.verbose) {
      this.logger.setLevel('debug');
    }
  }

  /**
   * クリーンアップ処理
   */
  private async cleanup(): Promise<void> {
    try {
      this.logger.debug('🧹 Cleaning up resources...');
      await this.dockerManager.cleanup();
      this.logger.debug('✅ Cleanup completed');
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

}
