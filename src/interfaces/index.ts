/**
 * Core interfaces for Bitbucket Pipelines Local Runner
 */

// CLI関連のインターフェース
export interface CLIOptions {
  pipeline?: string;           // 実行するパイプライン名
  branch?: string;            // ブランチ名
  custom?: string;            // カスタムパイプライン名
  verbose?: boolean;          // 詳細ログ
  dryRun?: boolean;          // ドライラン
  configFile?: string;       // 設定ファイルパス
  envFile?: string;          // 環境変数ファイル
  clearCache?: boolean;      // キャッシュクリア
}

export interface CLICommand {
  run(options: CLIOptions): Promise<void>;
  validate(options: CLIOptions): Promise<boolean>;
  listPipelines(): Promise<string[]>;
  clearCache(): Promise<void>;
}

// Bitbucket Pipelines設定のインターフェース
export interface PipelineConfig {
  image?: string | ImageConfig;
  options?: GlobalOptions;
  clone?: CloneConfig;
  definitions?: Definitions;
  pipelines: Pipelines;
}

export interface ImageConfig {
  name: string;
  username?: string;
  password?: string;
  aws?: AWSConfig;
  runAsUser?: number;
}

export interface AWSConfig {
  accessKey?: string;
  secretKey?: string;
}

export interface GlobalOptions {
  maxTime?: number;
  size?: string;
  docker?: boolean;
}

export interface CloneConfig {
  enabled?: boolean;
  depth?: number;
  lfs?: boolean;
}

export interface Definitions {
  caches?: Record<string, string>;
  services?: Record<string, ServiceDefinition>;
  steps?: Record<string, Step>;
}

export interface ServiceDefinition {
  image: string;
  variables?: Record<string, string>;
  ports?: string[];
  memory?: string;
}

export interface Pipelines {
  default?: Pipeline;
  branches?: Record<string, Pipeline>;
  tags?: Record<string, Pipeline>;
  bookmarks?: Record<string, Pipeline>;
  pullrequests?: Record<string, Pipeline>;
  custom?: Record<string, Pipeline>;
}

export type Pipeline = (Step | ParallelSteps)[];

export interface Step {
  name?: string;
  image?: string | ImageConfig;
  script: string[];
  size?: string;
  maxTime?: number;
  caches?: string[];
  artifacts?: ArtifactConfig;
  services?: string[];
  trigger?: 'automatic' | 'manual';
  condition?: ConditionConfig;
  afterScript?: string[];
  variables?: Record<string, string>;
  deployment?: string;
}

export interface ParallelSteps {
  parallel: {
    failFast?: boolean;
    steps: Step[];
  };
}

export interface ArtifactConfig {
  paths: string[];
  download?: boolean;
}

export interface ConditionConfig {
  changesets?: {
    includePaths?: string[];
    excludePaths?: string[];
  };
}

// パイプライン実行関連のインターフェース
export interface PipelineExecutor {
  execute(config: PipelineConfig, options: ExecutionOptions): Promise<ExecutionResult>;
  executeStep(step: Step, context: ExecutionContext): Promise<StepResult>;
  executeParallel(parallel: ParallelSteps, context: ExecutionContext): Promise<StepResult[]>;
}

export interface ExecutionOptions {
  dryRun?: boolean | undefined;
  verbose?: boolean | undefined;
  pipeline?: string | undefined;
  branch?: string | undefined;
  custom?: string | undefined;
}

export interface ExecutionContext {
  workspaceDir: string;
  artifactsDir: string;
  cacheDir: string;
  environment: Record<string, string>;
  services: ServiceContainer[];
  network?: string | undefined;
}

export interface ExecutionResult {
  success: boolean;
  steps: StepResult[];
  duration: number;
  error?: Error | undefined;
}

export interface StepResult {
  name: string;
  success: boolean;
  exitCode: number;
  duration: number;
  logs: string[];
  error?: Error | undefined;
}

// Docker関連のインターフェース
export interface DockerManager {
  pullImage(image: string, auth?: AuthConfig): Promise<void>;
  createContainer(config: ContainerConfig): Promise<Container>;
  runContainer(container: Container): Promise<ContainerResult>;
  stopContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  createNetwork(name: string): Promise<Network>;
  removeNetwork(networkId: string): Promise<void>;
  listContainers(): Promise<Container[]>;
  cleanup(): Promise<void>;
}

export interface AuthConfig {
  username: string;
  password: string;
  email?: string;
  serveraddress?: string;
}

export interface ContainerConfig {
  image: string;
  command: string[];
  environment: Record<string, string>;
  volumes: VolumeMount[];
  workingDir: string;
  network?: string | undefined;
  user?: string | undefined;
  memoryLimit?: string | undefined;
  cpuLimit?: string | undefined;
  ports?: PortConfig[] | undefined;
}

export interface VolumeMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface PortConfig {
  containerPort: number;
  hostPort?: number;
  protocol?: 'tcp' | 'udp';
}

export interface Container {
  id: string;
  name: string;
  config: ContainerConfig;
  status: 'created' | 'running' | 'stopped' | 'exited';
}

export interface ContainerResult {
  exitCode: number;
  output: string[];
  error?: string | undefined;
  duration: number;
}

export interface Network {
  id: string;
  name: string;
}

export interface ServiceContainer extends Container {
  healthCheck?: HealthCheck;
}

export interface HealthCheck {
  test: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

// キャッシュ管理のインターフェース
export interface CacheManager {
  getCachePath(cacheName: string): string;
  restoreCache(cacheName: string, targetPath: string): Promise<boolean>;
  saveCache(cacheName: string, sourcePath: string): Promise<void>;
  clearCache(cacheName?: string): Promise<void>;
  listCaches(): Promise<string[]>;
}

export interface CacheConfig {
  name: string;
  path: string;
  pattern?: string;
}

// アーティファクト管理のインターフェース
export interface ArtifactManager {
  saveArtifacts(patterns: string[], sourceDir: string, stepName: string): Promise<void>;
  restoreArtifacts(targetDir: string, stepName?: string): Promise<void>;
  listArtifacts(stepName?: string): Promise<string[]>;
  clearArtifacts(): Promise<void>;
}

// 環境変数管理のインターフェース
export interface EnvironmentManager {
  loadEnvironment(envFile?: string): Promise<Record<string, string>>;
  getBitbucketVariables(context: PipelineContext): Record<string, string>;
  mergeEnvironments(...envs: Record<string, string>[]): Record<string, string>;
  validateSecureVariables(variables: string[]): Promise<Record<string, string>>;
}

export interface PipelineContext {
  branch: string;
  commit: string;
  buildNumber: number;
  repoName: string;
  workspace: string;
  repoSlug: string;
  repoUuid: string;
  stepName?: string;
}

// 設定管理のインターフェース
export interface LocalRunnerConfig {
  docker: DockerConfig;
  cache: CacheConfig;
  artifacts: ArtifactConfigLocal;
  logging: LoggingConfig;
  environment: EnvironmentConfig;
}

export interface DockerConfig {
  registry?: RegistryConfig;
  defaultImage?: string;
  networkName?: string;
  volumePrefix?: string;
  resourceLimits?: ResourceLimits;
  socketPath?: string;
}

export interface RegistryConfig {
  url?: string;
  username?: string;
  password?: string;
}

export interface ResourceLimits {
  memory: Record<string, string>;  // "1x": "4g", "2x": "8g"
  cpu: Record<string, string>;     // "1x": "2", "2x": "4"
}

export interface ArtifactConfigLocal {
  baseDir: string;
  enabled: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'text' | 'json';
  showDockerCommands: boolean;
  showTimestamps: boolean;
}

export interface EnvironmentConfig {
  bitbucketVariables: Record<string, string>;
  secureVariables?: Record<string, string>;
  envFile?: string;
}

// エラー関連のインターフェース
export enum ErrorType {
  YAML_PARSE_ERROR = 'yaml_parse_error',
  DOCKER_ERROR = 'docker_error',
  CONTAINER_ERROR = 'container_error',
  NETWORK_ERROR = 'network_error',
  FILE_SYSTEM_ERROR = 'file_system_error',
  VALIDATION_ERROR = 'validation_error',
  TIMEOUT_ERROR = 'timeout_error',
  USER_CANCELLED = 'user_cancelled'
}

export class PipelineError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public details?: any,
    public step?: string
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

// ログ関連のインターフェース
export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'system' | 'container' | 'docker';
  message: string;
  step?: string | undefined;
}

export interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  setLevel(level: string): void;
}

// バリデーター関連のインターフェース
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  type: 'required' | 'type' | 'format' | 'constraint';
}

export interface ValidationWarning {
  path: string;
  message: string;
  type: 'deprecated' | 'performance' | 'best-practice';
}

export interface PipelineValidator {
  validate(config: PipelineConfig): ValidationResult;
  validateStep(step: Step): ValidationResult;
}

// パーサー関連のインターフェース
export interface YAMLParser {
  parse(yamlContent: string): PipelineConfig;
  parseFile(filePath: string): Promise<PipelineConfig>;
}

// 設定管理関連のインターフェース
export interface ConfigManager {
  loadConfig(projectDir: string): Promise<LocalRunnerConfig>;
  mergeConfigs(...configs: Partial<LocalRunnerConfig>[]): LocalRunnerConfig;
  validateConfig(config: LocalRunnerConfig): ValidationResult;
  getDefaultConfig(): LocalRunnerConfig;
}
