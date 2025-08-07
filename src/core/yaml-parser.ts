import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import {
  YAMLParser as IYAMLParser,
  PipelineConfig,
  PipelineError,
  ErrorType
} from '../interfaces';

export class YAMLParser implements IYAMLParser {
  /**
   * YAML文字列をパース
   */
  parse(yamlContent: string): PipelineConfig {
    try {
      const parsed = YAML.parse(yamlContent);

      if (!parsed) {
        throw new PipelineError(
          ErrorType.YAML_PARSE_ERROR,
          'Empty or invalid YAML content'
        );
      }

      if (typeof parsed !== 'object') {
        throw new PipelineError(
          ErrorType.YAML_PARSE_ERROR,
          'YAML root must be an object'
        );
      }

      // 基本的な構造チェック
      if (!parsed.pipelines) {
        throw new PipelineError(
          ErrorType.VALIDATION_ERROR,
          'pipelines section is required'
        );
      }

      return this.transformConfig(parsed);
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new PipelineError(
          ErrorType.YAML_PARSE_ERROR,
          `YAML parse error: ${error.message}`,
          error
        );
      }

      throw new PipelineError(
        ErrorType.YAML_PARSE_ERROR,
        'Unknown YAML parse error'
      );
    }
  }

  /**
   * ファイルからYAMLを読み込んでパース
   */
  async parseFile(filePath: string): Promise<PipelineConfig> {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = await fs.readFile(resolvedPath, 'utf8');
      return this.parse(content);
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PipelineError(
          ErrorType.FILE_SYSTEM_ERROR,
          `Pipeline configuration file not found: ${filePath}`
        );
      }

      throw new PipelineError(
        ErrorType.FILE_SYSTEM_ERROR,
        `Failed to read pipeline configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * パースしたYAMLを内部形式に変換
   */
  private transformConfig(parsed: any): PipelineConfig {
    const config: PipelineConfig = {
      pipelines: {}
    };

    // image の処理
    if (parsed.image) {
      config.image = this.transformImage(parsed.image);
    }

    // options の処理
    if (parsed.options) {
      config.options = this.transformOptions(parsed.options);
    }

    // clone の処理
    if (parsed.clone) {
      config.clone = this.transformClone(parsed.clone);
    }

    // definitions の処理
    if (parsed.definitions) {
      config.definitions = this.transformDefinitions(parsed.definitions);
    }

    // pipelines の処理
    config.pipelines = this.transformPipelines(parsed.pipelines);

    return config;
  }

  /**
   * image 設定を変換
   */
  private transformImage(image: any): string | any {
    if (typeof image === 'string') {
      return image;
    }

    if (typeof image === 'object' && image.name) {
      return {
        name: image.name,
        username: image.username,
        password: image.password,
        aws: image.aws,
        runAsUser: image['run-as-user'] || image.runAsUser
      };
    }

    throw new PipelineError(
      ErrorType.VALIDATION_ERROR,
      'Invalid image configuration'
    );
  }

  /**
   * options 設定を変換
   */
  private transformOptions(options: any): any {
    return {
      maxTime: options['max-time'] || options.maxTime,
      size: options.size,
      docker: options.docker
    };
  }

  /**
   * clone 設定を変換
   */
  private transformClone(clone: any): any {
    return {
      enabled: clone.enabled !== false, // デフォルトは true
      depth: clone.depth,
      lfs: clone.lfs
    };
  }

  /**
   * definitions 設定を変換
   */
  private transformDefinitions(definitions: any): any {
    const result: any = {};

    // caches の処理
    if (definitions.caches) {
      result.caches = definitions.caches;
    }

    // services の処理
    if (definitions.services) {
      result.services = {};
      Object.entries(definitions.services).forEach(([key, service]: [string, any]) => {
        result.services[key] = {
          image: service.image,
          variables: service.variables,
          ports: service.ports,
          memory: service.memory
        };
      });
    }

    // steps の処理
    if (definitions.steps) {
      result.steps = {};
      Object.entries(definitions.steps).forEach(([key, step]: [string, any]) => {
        result.steps[key] = this.transformStep(step);
      });
    }

    return result;
  }

  /**
   * pipelines 設定を変換
   */
  private transformPipelines(pipelines: any): any {
    const result: any = {};

    // default pipeline
    if (pipelines.default) {
      result.default = this.transformPipeline(pipelines.default);
    }

    // branches
    if (pipelines.branches) {
      result.branches = {};
      Object.entries(pipelines.branches).forEach(([key, pipeline]: [string, any]) => {
        result.branches[key] = this.transformPipeline(pipeline);
      });
    }

    // tags
    if (pipelines.tags) {
      result.tags = {};
      Object.entries(pipelines.tags).forEach(([key, pipeline]: [string, any]) => {
        result.tags[key] = this.transformPipeline(pipeline);
      });
    }

    // pull-requests
    if (pipelines['pull-requests']) {
      result.pullrequests = {};
      Object.entries(pipelines['pull-requests']).forEach(([key, pipeline]: [string, any]) => {
        result.pullrequests[key] = this.transformPipeline(pipeline);
      });
    }

    // custom
    if (pipelines.custom) {
      result.custom = {};
      Object.entries(pipelines.custom).forEach(([key, pipeline]: [string, any]) => {
        result.custom[key] = this.transformPipeline(pipeline);
      });
    }

    return result;
  }

  /**
   * パイプライン設定を変換
   */
  private transformPipeline(pipeline: any[]): any[] {
    return pipeline.map(item => {
      // 直接 step として定義されている場合
      if (item.script || item.name) {
        return this.transformStep(item);
      }

      // step オブジェクトとして定義されている場合
      if (item.step) {
        return this.transformStep(item.step);
      }

      // parallel として定義されている場合
      if (item.parallel) {
        return {
          parallel: {
            failFast: item.parallel['fail-fast'] !== false, // デフォルトは true
            steps: item.parallel.steps.map((step: any) => {
              // step オブジェクトとして定義されている場合
              if (step.step) {
                return this.transformStep(step.step);
              }
              // 直接 step として定義されている場合
              return this.transformStep(step);
            })
          }
        };
      }

      throw new PipelineError(
        ErrorType.VALIDATION_ERROR,
        'Pipeline item must contain either "step" or "parallel"'
      );
    });
  }

  /**
   * ステップ設定を変換
   */
  private transformStep(step: any): any {
    if (!step.script) {
      throw new PipelineError(
        ErrorType.VALIDATION_ERROR,
        `Step must contain script. Got: ${JSON.stringify(step, null, 2)}`
      );
    }

    return {
      name: step.name,
      image: step.image ? this.transformImage(step.image) : undefined,
      script: Array.isArray(step.script) ? step.script : [step.script],
      size: step.size,
      maxTime: step['max-time'] || step.maxTime,
      caches: step.caches,
      artifacts: step.artifacts ? this.transformArtifacts(step.artifacts) : undefined,
      services: step.services,
      trigger: step.trigger,
      condition: step.condition ? this.transformCondition(step.condition) : undefined,
      afterScript: step['after-script'] || step.afterScript,
      variables: step.variables,
      deployment: step.deployment
    };
  }

  /**
   * artifacts 設定を変換
   */
  private transformArtifacts(artifacts: any): any {
    if (Array.isArray(artifacts)) {
      return { paths: artifacts };
    }

    return {
      paths: artifacts.paths || [],
      download: artifacts.download !== false
    };
  }

  /**
   * condition 設定を変換
   */
  private transformCondition(condition: any): any {
    return {
      changesets: condition.changesets ? {
        includePaths: condition.changesets.includePaths || condition.changesets['include-paths'],
        excludePaths: condition.changesets.excludePaths || condition.changesets['exclude-paths']
      } : undefined
    };
  }
}
