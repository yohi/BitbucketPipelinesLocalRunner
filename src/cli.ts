#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { BitbucketPipelinesRunner } from './core/runner';
import { Logger } from './utils/logger';
import { ConfigManager } from './managers/config-manager';
import { CLIOptions } from './interfaces';

const program = new Command();

program
  .name('bbpl')
  .description('Bitbucket Pipelines Local Runner - Run Bitbucket Pipelines locally using Docker')
  .version('1.0.0');

program
  .command('run')
  .description('Run a pipeline locally')
  .option('-p, --pipeline <name>', 'Pipeline name to run (default, branch, or custom)')
  .option('-b, --branch <name>', 'Branch name for branch-specific pipeline')
  .option('-c, --custom <name>', 'Custom pipeline name')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-d, --dry-run', 'Perform a dry run without executing commands')
  .option('--config <path>', 'Path to configuration file')
  .option('--env-file <path>', 'Path to environment variables file')
  .action(async (options: CLIOptions) => {
    try {
      const logger = new Logger(options.verbose ? 'debug' : 'info');
      const configManager = new ConfigManager(logger);
      const config = await configManager.loadConfig(process.cwd());

      const runner = new BitbucketPipelinesRunner(config, logger);

      logger.info(chalk.blue('🚀 Starting Bitbucket Pipelines Local Runner'));

      if (options.dryRun) {
        logger.info(chalk.yellow('📋 Dry run mode enabled - no commands will be executed'));
      }

      await runner.run(options);

      logger.info(chalk.green('✅ Pipeline execution completed successfully'));
    } catch (error) {
      const logger = new Logger('error');
      if (error instanceof Error) {
        logger.error(chalk.red(`❌ Pipeline execution failed: ${error.message}`));
        if (options.verbose) {
          logger.error(error.stack || '');
        }
      } else {
        logger.error(chalk.red('❌ Unknown error occurred'));
      }
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate bitbucket-pipelines.yml configuration')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--config <path>', 'Path to configuration file')
  .action(async (options: CLIOptions) => {
    try {
      const logger = new Logger(options.verbose ? 'debug' : 'info');
      const configManager = new ConfigManager(logger);
      const config = await configManager.loadConfig(process.cwd());

      const runner = new BitbucketPipelinesRunner(config, logger);

      logger.info(chalk.blue('🔍 Validating pipeline configuration'));

      const isValid = await runner.validate(options);

      if (isValid) {
        logger.info(chalk.green('✅ Pipeline configuration is valid'));
      } else {
        logger.error(chalk.red('❌ Pipeline configuration has errors'));
        process.exit(1);
      }
    } catch (error) {
      const logger = new Logger('error');
      if (error instanceof Error) {
        logger.error(chalk.red(`❌ Validation failed: ${error.message}`));
        if (options.verbose) {
          logger.error(error.stack || '');
        }
      }
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List available pipelines')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: CLIOptions) => {
    try {
      const logger = new Logger(options.verbose ? 'debug' : 'info');
      const configManager = new ConfigManager(logger);
      const config = await configManager.loadConfig(process.cwd());

      const runner = new BitbucketPipelinesRunner(config, logger);

      logger.info(chalk.blue('📋 Available pipelines:'));

      const pipelines = await runner.listPipelines();

      if (pipelines.length === 0) {
        logger.info(chalk.yellow('  No pipelines found'));
      } else {
        pipelines.forEach(pipeline => {
          logger.info(chalk.green(`  - ${pipeline}`));
        });
      }
    } catch (error) {
      const logger = new Logger('error');
      if (error instanceof Error) {
        logger.error(chalk.red(`❌ Failed to list pipelines: ${error.message}`));
      }
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean up local cache and artifacts')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--cache', 'Clear cache only')
  .option('--artifacts', 'Clear artifacts only')
  .action(async (options: CLIOptions & { cache?: boolean; artifacts?: boolean }) => {
    try {
      const logger = new Logger(options.verbose ? 'debug' : 'info');
      const configManager = new ConfigManager(logger);
      const config = await configManager.loadConfig(process.cwd());

      const runner = new BitbucketPipelinesRunner(config, logger);

      logger.info(chalk.blue('🧹 Cleaning up local data'));

      await runner.clearCache();

      logger.info(chalk.green('✅ Cleanup completed'));
    } catch (error) {
      const logger = new Logger('error');
      if (error instanceof Error) {
        logger.error(chalk.red(`❌ Cleanup failed: ${error.message}`));
      }
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize local runner configuration')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options: CLIOptions) => {
    try {
      const logger = new Logger(options.verbose ? 'debug' : 'info');
      const configManager = new ConfigManager(logger);

      logger.info(chalk.blue('🔧 Initializing local runner configuration'));

      await configManager.initializeConfig(process.cwd());

      logger.info(chalk.green('✅ Configuration initialized successfully'));
      logger.info(chalk.blue('📝 Edit .bitbucket-pipelines-local.yml to customize settings'));
    } catch (error) {
      const logger = new Logger('error');
      if (error instanceof Error) {
        logger.error(chalk.red(`❌ Initialization failed: ${error.message}`));
      }
      process.exit(1);
    }
  });

// エラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('error');
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  const logger = new Logger('error');
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Ctrl+C ハンドリング
process.on('SIGINT', () => {
  const logger = new Logger('info');
  logger.info(chalk.yellow('\n🛑 Received SIGINT. Cleaning up and exiting...'));
  process.exit(0);
});

program.parse();
