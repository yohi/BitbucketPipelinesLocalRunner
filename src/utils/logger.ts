import winston from 'winston';
import chalk from 'chalk';
import { LogEntry, Logger as ILogger } from '../interfaces';

export class Logger implements ILogger {
  private winston: winston.Logger;

  constructor(level: string = 'info') {
    this.winston = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'bitbucket-pipelines-local' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const timestampValue = typeof timestamp === 'string' ? timestamp : 
                                   timestamp instanceof Date ? timestamp.toISOString() :
                                   typeof timestamp === 'number' ? new Date(timestamp).toISOString() :
                                   new Date().toISOString();
              const time = chalk.gray(`[${new Date(timestampValue).toLocaleTimeString()}]`);
              return `${time} ${level}: ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`;
            })
          )
        })
      ]
    });
  }

  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  error(message: string, meta?: any): void {
    this.winston.error(message, meta);
  }

  setLevel(level: string): void {
    this.winston.level = level;
  }

  // ステップ実行用のフォーマット済みログ
  stepStart(stepName: string): void {
    this.info(chalk.blue(`🔨 Starting step: ${chalk.bold(stepName)}`));
  }

  stepComplete(stepName: string, duration: number): void {
    this.info(chalk.green(`✅ Step completed: ${chalk.bold(stepName)} (${duration}ms)`));
  }

  stepFailed(stepName: string, duration: number, error?: string): void {
    this.error(chalk.red(`❌ Step failed: ${chalk.bold(stepName)} (${duration}ms)${error ? ` - ${error}` : ''}`));
  }

  // Docker操作用のログ
  dockerInfo(message: string, meta?: any): void {
    this.debug(chalk.cyan(`🐳 Docker: ${message}`), meta);
  }

  dockerCommand(command: string): void {
    this.debug(chalk.gray(`$ ${command}`));
  }

  // キャッシュ操作用のログ
  cacheHit(cacheName: string): void {
    this.debug(chalk.green(`💾 Cache hit: ${cacheName}`));
  }

  cacheMiss(cacheName: string): void {
    this.debug(chalk.yellow(`💾 Cache miss: ${cacheName}`));
  }

  cacheSaved(cacheName: string): void {
    this.debug(chalk.blue(`💾 Cache saved: ${cacheName}`));
  }

  // アーティファクト操作用のログ
  artifactsSaved(count: number): void {
    this.debug(chalk.blue(`📦 Artifacts saved: ${count} files`));
  }

  artifactsRestored(count: number): void {
    this.debug(chalk.green(`📦 Artifacts restored: ${count} files`));
  }

  // サービス関連のログ
  serviceStarting(serviceName: string): void {
    this.info(chalk.blue(`🔧 Starting service: ${chalk.bold(serviceName)}`));
  }

  serviceReady(serviceName: string): void {
    this.info(chalk.green(`✅ Service ready: ${chalk.bold(serviceName)}`));
  }

  serviceFailed(serviceName: string, error: string): void {
    this.error(chalk.red(`❌ Service failed: ${chalk.bold(serviceName)} - ${error}`));
  }

  // 進行状況のログ
  progress(current: number, total: number, message: string): void {
    const percentage = total === 0 ? 0 : Math.round((current / total) * 100);
    const bar = this.createProgressBar(percentage);
    this.info(`${bar} ${percentage}% ${message}`);
  }

  private createProgressBar(percentage: number, length: number = 20): string {
    const filledLength = Math.round((percentage / 100) * length);
    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(length - filledLength);
    return chalk.blue(`[${filled}${empty}]`);
  }

  // 設定やバリデーション用のログ
  configLoaded(configPath: string): void {
    this.debug(chalk.blue(`⚙️  Configuration loaded: ${configPath}`));
  }

  validationError(path: string, message: string): void {
    this.error(chalk.red(`🚫 Validation error at ${chalk.bold(path)}: ${message}`));
  }

  validationWarning(path: string, message: string): void {
    this.warn(chalk.yellow(`⚠️  Warning at ${chalk.bold(path)}: ${message}`));
  }

  // パフォーマンス関連のログ
  timing(operation: string, duration: number): void {
    const color = duration > 10000 ? chalk.red : duration > 5000 ? chalk.yellow : chalk.green;
    this.debug(color(`⏱️  ${operation}: ${duration}ms`));
  }

  // 明示的なメッセージタイプ
  success(message: string): void {
    this.info(chalk.green(message));
  }

  warning(message: string): void {
    this.warn(chalk.yellow(message));
  }

  failure(message: string): void {
    this.error(chalk.red(message));
  }

  // リアルタイムコンテナログ用
  containerOutput(output: string, stepName?: string): void {
    const prefix = stepName ? chalk.gray(`[${stepName}]`) : '';
    // ANSI エスケープシーケンスを保持してそのまま出力
    process.stdout.write(`${prefix} ${output}`);
  }

  // ヘルパーメソッド
  createLogEntry(level: 'info' | 'warn' | 'error' | 'debug', message: string, source: 'system' | 'container' | 'docker', step?: string): LogEntry {
    return {
      timestamp: new Date(),
      level,
      source,
      message,
      step: step || undefined
    };
  }
}
