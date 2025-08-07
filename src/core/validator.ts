import {
  PipelineValidator as IPipelineValidator,
  PipelineConfig,
  Step,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ParallelSteps
} from '../interfaces';

export class PipelineValidator implements IPipelineValidator {
  private readonly SUPPORTED_SIZES = ['1x', '2x', '4x', '8x', '16x'];
  private readonly SUPPORTED_TRIGGERS = ['automatic', 'manual'];
  private readonly MAX_SCRIPT_LINES = 100;
  private readonly MAX_STEP_TIME = 120; // minutes
  // NOTE: 事前定義キャッシュの一覧（将来的にバリデーションで使用する可能性があるため保持）
  // private readonly PREDEFINED_CACHES = [
  //   'docker', 'node', 'npm', 'yarn', 'pip-cache', 'composer',
  //   'gradle', 'maven', 'sbt', 'dotnetcore'
  // ];

  /**
   * パイプライン設定全体をバリデーション
   */
  validate(config: PipelineConfig): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // pipelines セクションの存在確認
    if (!config.pipelines) {
      errors.push({
        path: 'pipelines',
        message: 'pipelines section is required',
        type: 'required'
      });
      return { valid: false, errors, warnings };
    }

    // デフォルトパイプラインの存在確認
    if (!config.pipelines.default &&
      !config.pipelines.branches &&
      !config.pipelines.custom) {
      warnings.push({
        path: 'pipelines',
        message: 'No default pipeline defined. Consider adding a default pipeline for easier usage.',
        type: 'best-practice'
      });
    }

    // 各パイプラインをバリデーション
    this.validatePipelines(config.pipelines, errors, warnings);

    // definitions をバリデーション
    if (config.definitions) {
      this.validateDefinitions(config.definitions, errors, warnings);
    }

    // グローバルオプションをバリデーション
    if (config.options) {
      this.validateGlobalOptions(config.options, errors, warnings);
    }

    // グローバルイメージをバリデーション
    if (config.image) {
      this.validateImage(config.image, 'image', errors, warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 単一ステップをバリデーション
   */
  validateStep(step: Step): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    this.validateSingleStep(step, 'step', errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * パイプライン群をバリデーション
   */
  private validatePipelines(pipelines: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // default
    if (pipelines.default) {
      this.validatePipeline(pipelines.default, 'pipelines.default', errors, warnings);
    }

    // branches
    if (pipelines.branches) {
      Object.entries(pipelines.branches).forEach(([branch, pipeline]: [string, any]) => {
        this.validatePipeline(pipeline, `pipelines.branches.${branch}`, errors, warnings);
      });
    }

    // tags
    if (pipelines.tags) {
      Object.entries(pipelines.tags).forEach(([tag, pipeline]: [string, any]) => {
        this.validatePipeline(pipeline, `pipelines.tags.${tag}`, errors, warnings);
      });
    }

    // pull-requests
    if (pipelines.pullrequests) {
      Object.entries(pipelines.pullrequests).forEach(([pattern, pipeline]: [string, any]) => {
        this.validatePipeline(pipeline, `pipelines.pullrequests.${pattern}`, errors, warnings);
      });
    }

    // custom
    if (pipelines.custom) {
      Object.entries(pipelines.custom).forEach(([name, pipeline]: [string, any]) => {
        this.validatePipeline(pipeline, `pipelines.custom.${name}`, errors, warnings);

        // カスタムパイプライン名の検証
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          warnings.push({
            path: `pipelines.custom.${name}`,
            message: 'Custom pipeline names should only contain alphanumeric characters, hyphens, and underscores',
            type: 'best-practice'
          });
        }
      });
    }
  }

  /**
   * 単一パイプラインをバリデーション
   */
  private validatePipeline(pipeline: any[], path: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!Array.isArray(pipeline)) {
      errors.push({
        path,
        message: 'Pipeline must be an array of steps',
        type: 'type'
      });
      return;
    }

    if (pipeline.length === 0) {
      warnings.push({
        path,
        message: 'Pipeline is empty',
        type: 'best-practice'
      });
      return;
    }

    pipeline.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;

      if (this.isStep(item)) {
        this.validateSingleStep(item, itemPath, errors, warnings);
      } else if (this.isParallelSteps(item)) {
        this.validateParallelSteps(item, itemPath, errors, warnings);
      } else {
        errors.push({
          path: itemPath,
          message: 'Pipeline item must be either a step or parallel steps',
          type: 'type'
        });
      }
    });

    // パイプライン全体の制限チェック
    if (pipeline.length > 100) {
      warnings.push({
        path,
        message: 'Pipeline has many steps. Consider breaking it into smaller pipelines for better maintainability.',
        type: 'performance'
      });
    }
  }

  /**
   * 単一ステップをバリデーション
   */
  private validateSingleStep(step: Step, path: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // script の必須チェック
    if (!step.script || step.script.length === 0) {
      errors.push({
        path: `${path}.script`,
        message: 'script is required and cannot be empty',
        type: 'required'
      });
    } else {
      // スクリプトの行数チェック
      if (step.script.length > this.MAX_SCRIPT_LINES) {
        warnings.push({
          path: `${path}.script`,
          message: `Script has ${step.script.length} lines. Consider breaking long scripts into smaller functions.`,
          type: 'best-practice'
        });
      }

      // 空のスクリプト行チェック
      step.script.forEach((line, index) => {
        if (typeof line !== 'string') {
          errors.push({
            path: `${path}.script[${index}]`,
            message: 'Script line must be a string',
            type: 'type'
          });
        } else if (line.trim() === '') {
          warnings.push({
            path: `${path}.script[${index}]`,
            message: 'Empty script line',
            type: 'best-practice'
          });
        }
      });
    }

    // size のバリデーション
    if (step.size && !this.SUPPORTED_SIZES.includes(step.size)) {
      errors.push({
        path: `${path}.size`,
        message: `Invalid size: ${step.size}. Supported sizes: ${this.SUPPORTED_SIZES.join(', ')}`,
        type: 'constraint'
      });
    }

    // maxTime のバリデーション
    if (step.maxTime !== undefined) {
      if (typeof step.maxTime !== 'number' || step.maxTime <= 0) {
        errors.push({
          path: `${path}.maxTime`,
          message: 'maxTime must be a positive number',
          type: 'type'
        });
      } else if (step.maxTime > this.MAX_STEP_TIME) {
        warnings.push({
          path: `${path}.maxTime`,
          message: `maxTime is set to ${step.maxTime} minutes. Very long-running steps may impact performance.`,
          type: 'performance'
        });
      }
    }

    // trigger のバリデーション
    if (step.trigger && !this.SUPPORTED_TRIGGERS.includes(step.trigger)) {
      errors.push({
        path: `${path}.trigger`,
        message: `Invalid trigger: ${step.trigger}. Supported triggers: ${this.SUPPORTED_TRIGGERS.join(', ')}`,
        type: 'constraint'
      });
    }

    // caches のバリデーション
    if (step.caches) {
      step.caches.forEach((cache, index) => {
        if (typeof cache !== 'string') {
          errors.push({
            path: `${path}.caches[${index}]`,
            message: 'Cache name must be a string',
            type: 'type'
          });
        }
      });
    }

    // artifacts のバリデーション
    if (step.artifacts) {
      this.validateArtifacts(step.artifacts, `${path}.artifacts`, errors, warnings);
    }

    // services のバリデーション
    if (step.services) {
      step.services.forEach((service, index) => {
        if (typeof service !== 'string') {
          errors.push({
            path: `${path}.services[${index}]`,
            message: 'Service name must be a string',
            type: 'type'
          });
        }
      });
    }

    // image のバリデーション
    if (step.image) {
      this.validateImage(step.image, `${path}.image`, errors, warnings);
    }

    // name のバリデーション
    if (step.name) {
      if (step.name.length > 50) {
        warnings.push({
          path: `${path}.name`,
          message: 'Step name is quite long. Consider using shorter, descriptive names.',
          type: 'best-practice'
        });
      }
    }
  }

  /**
   * 並列ステップをバリデーション
   */
  private validateParallelSteps(parallelSteps: ParallelSteps, path: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    const parallel = parallelSteps.parallel;

    if (!parallel || !parallel.steps) {
      errors.push({
        path: `${path}.parallel.steps`,
        message: 'parallel.steps is required',
        type: 'required'
      });
      return;
    }

    if (!Array.isArray(parallel.steps)) {
      errors.push({
        path: `${path}.parallel.steps`,
        message: 'parallel.steps must be an array',
        type: 'type'
      });
      return;
    }

    if (parallel.steps.length === 0) {
      warnings.push({
        path: `${path}.parallel.steps`,
        message: 'Empty parallel steps',
        type: 'best-practice'
      });
      return;
    }

    if (parallel.steps.length === 1) {
      warnings.push({
        path: `${path}.parallel.steps`,
        message: 'Only one step in parallel block. Consider removing parallel wrapper.',
        type: 'best-practice'
      });
    }

    // 各並列ステップをバリデーション
    parallel.steps.forEach((step, index) => {
      this.validateSingleStep(step, `${path}.parallel.steps[${index}]`, errors, warnings);
    });

    // 並列ステップ数の制限チェック
    if (parallel.steps.length > 10) {
      warnings.push({
        path: `${path}.parallel.steps`,
        message: `${parallel.steps.length} parallel steps may consume significant resources. Consider reducing concurrency.`,
        type: 'performance'
      });
    }
  }

  /**
   * definitions をバリデーション
   */
  private validateDefinitions(definitions: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    // services のバリデーション
    if (definitions.services) {
      Object.entries(definitions.services).forEach(([name, service]: [string, any]) => {
        this.validateServiceDefinition(service, `definitions.services.${name}`, errors, warnings);
      });
    }

    // caches のバリデーション
    if (definitions.caches) {
      Object.entries(definitions.caches).forEach(([name, path]: [string, any]) => {
        if (typeof path !== 'string') {
          errors.push({
            path: `definitions.caches.${name}`,
            message: 'Cache path must be a string',
            type: 'type'
          });
        }
      });
    }
  }

  /**
   * サービス定義をバリデーション
   */
  private validateServiceDefinition(service: any, path: string, errors: ValidationError[], _warnings: ValidationWarning[]): void {
    if (!service.image) {
      errors.push({
        path: `${path}.image`,
        message: 'Service image is required',
        type: 'required'
      });
    }

    if (service.variables && typeof service.variables !== 'object') {
      errors.push({
        path: `${path}.variables`,
        message: 'Service variables must be an object',
        type: 'type'
      });
    }

    if (service.ports) {
      if (!Array.isArray(service.ports)) {
        errors.push({
          path: `${path}.ports`,
          message: 'Service ports must be an array',
          type: 'type'
        });
      } else {
        service.ports.forEach((port: any, index: number) => {
          if (typeof port !== 'string') {
            errors.push({
              path: `${path}.ports[${index}]`,
              message: 'Port must be a string',
              type: 'type'
            });
          }
        });
      }
    }
  }

  /**
   * グローバルオプションをバリデーション
   */
  private validateGlobalOptions(options: any, errors: ValidationError[], _warnings: ValidationWarning[]): void {
    if (options.size && !this.SUPPORTED_SIZES.includes(options.size)) {
      errors.push({
        path: 'options.size',
        message: `Invalid global size: ${options.size}. Supported sizes: ${this.SUPPORTED_SIZES.join(', ')}`,
        type: 'constraint'
      });
    }

    if (options.maxTime !== undefined) {
      if (typeof options.maxTime !== 'number' || options.maxTime <= 0) {
        errors.push({
          path: 'options.maxTime',
          message: 'Global maxTime must be a positive number',
          type: 'type'
        });
      }
    }
  }

  /**
   * アーティファクトをバリデーション
   */
  private validateArtifacts(artifacts: any, path: string, errors: ValidationError[], _warnings: ValidationWarning[]): void {
    if (!artifacts.paths) {
      errors.push({
        path: `${path}.paths`,
        message: 'artifacts.paths is required',
        type: 'required'
      });
      return;
    }

    if (!Array.isArray(artifacts.paths)) {
      errors.push({
        path: `${path}.paths`,
        message: 'artifacts.paths must be an array',
        type: 'type'
      });
      return;
    }

    artifacts.paths.forEach((artifactPath: any, index: number) => {
      if (typeof artifactPath !== 'string') {
        errors.push({
          path: `${path}.paths[${index}]`,
          message: 'Artifact path must be a string',
          type: 'type'
        });
      }
    });
  }

  /**
   * イメージ設定をバリデーション
   */
  private validateImage(image: any, path: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (typeof image === 'string') {
      // 文字列の場合は基本的なフォーマットチェック
      if (!image.trim()) {
        errors.push({
          path,
          message: 'Image name cannot be empty',
          type: 'required'
        });
      }
    } else if (typeof image === 'object') {
      if (!image.name) {
        errors.push({
          path: `${path}.name`,
          message: 'Image name is required',
          type: 'required'
        });
      }

      if (image.username && !image.password) {
        warnings.push({
          path: `${path}.password`,
          message: 'Username specified without password. Authentication may fail.',
          type: 'best-practice'
        });
      }
    } else {
      errors.push({
        path,
        message: 'Image must be a string or object',
        type: 'type'
      });
    }
  }

  /**
   * アイテムがステップかどうかを判定
   */
  private isStep(item: any): item is Step {
    return item && typeof item === 'object' && item.script && !item.parallel;
  }

  /**
   * アイテムが並列ステップかどうかを判定
   */
  private isParallelSteps(item: any): item is ParallelSteps {
    return item && typeof item === 'object' && item.parallel;
  }
}
