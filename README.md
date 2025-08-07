# Bitbucket Pipelines Local Runner

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue.svg)](https://www.typescriptlang.org/)

🚀 **Local runner for Bitbucket Pipelines that allows developers to test pipeline configurations locally using Docker**

## 📋 Overview

Bitbucket Pipelines Local Runner (`bbpl`) is a command-line tool that enables developers to run and test their Bitbucket Pipelines configurations locally without pushing to the repository. This tool helps catch issues early in the development process and reduces CI/CD feedback loops.

## ✨ Features

- 🐳 **Docker Integration** - Execute pipelines in isolated Docker containers
- ⚡ **Fast Feedback** - Test pipeline changes without committing to repository
- 💾 **Cache Management** - Support for build caches to speed up execution
- 📦 **Artifact Handling** - Save and restore pipeline artifacts
- 🔍 **Configuration Validation** - Validate `bitbucket-pipelines.yml` syntax and structure
- 🧪 **Dry Run Mode** - Preview pipeline execution without running commands
- 📊 **Comprehensive Logging** - Detailed execution logs with multiple verbosity levels
- ⚙️ **Environment Variables** - Full support for environment variable management
- 🔄 **Parallel Execution** - Support for parallel pipeline steps

## 🚀 Quick Start

### Installation

```bash
npm install -g bitbucket-pipelines-local-runner
```

Or run directly with npx:

```bash
npx bitbucket-pipelines-local-runner
```

### Basic Usage

```bash
# Run default pipeline
bbpl run

# Run specific pipeline
bbpl run --pipeline custom/deployment

# Run branch-specific pipeline
bbpl run --branch develop

# Validate configuration
bbpl validate

# List available pipelines
bbpl list

# Initialize configuration
bbpl init
```

## 📖 Commands

### `run` - Execute Pipeline

Run a pipeline locally using Docker containers.

```bash
bbpl run [options]

Options:
  -p, --pipeline <name>    Pipeline name (default, branch, or custom)
  -b, --branch <name>      Branch name for branch-specific pipeline
  -c, --custom <name>      Custom pipeline name
  -v, --verbose            Enable verbose logging
  -d, --dry-run           Perform dry run without executing commands
  --config <path>         Path to configuration file
  --env-file <path>       Path to environment variables file
```

**Examples:**
```bash
# Run default pipeline
bbpl run

# Run custom pipeline with verbose logging
bbpl run --custom deployment --verbose

# Dry run for testing
bbpl run --dry-run --verbose

# Use custom config and environment files
bbpl run --config .bbpl-config.yml --env-file .env.production
```

### `validate` - Validate Configuration

Validate your `bitbucket-pipelines.yml` configuration file.

```bash
bbpl validate [options]

Options:
  -v, --verbose           Enable verbose logging
  --config <path>         Path to configuration file
```

### `list` - List Pipelines

Display all available pipelines in your configuration.

```bash
bbpl list [options]

Options:
  -v, --verbose           Enable verbose logging
```

### `clean` - Clean Up

Clean local cache and artifacts.

```bash
bbpl clean [options]

Options:
  -v, --verbose           Enable verbose logging
  --cache                 Clear cache only
  --artifacts             Clear artifacts only
```

### `init` - Initialize Configuration

Create initial local runner configuration file.

```bash
bbpl init [options]

Options:
  -v, --verbose           Enable verbose logging
```

## ⚙️ Configuration

### Local Runner Configuration

Create `.bitbucket-pipelines-local.yml` in your project root:

```yaml
docker:
  registry:
    url: "docker.io"
    username: "${DOCKER_USERNAME}"
    password: "${DOCKER_PASSWORD}"
  defaultImage: "node:18"
  networkName: "bbpl-network"
  resourceLimits:
    memory:
      "1x": "4g"
      "2x": "8g"
    cpu:
      "1x": "2"
      "2x": "4"

cache:
  baseDir: ".bbpl-cache"
  enabled: true

artifacts:
  baseDir: ".bbpl-artifacts"
  enabled: true

logging:
  level: "info"
  format: "text"
  showDockerCommands: false
  showTimestamps: true

environment:
  bitbucketVariables:
    BITBUCKET_REPO_SLUG: "my-repo"
    BITBUCKET_WORKSPACE: "my-workspace"
  envFile: ".env"
```

### Environment Variables

The tool supports standard Bitbucket environment variables:

- `BITBUCKET_BRANCH`
- `BITBUCKET_COMMIT`
- `BITBUCKET_BUILD_NUMBER`
- `BITBUCKET_REPO_SLUG`
- `BITBUCKET_WORKSPACE`
- `BITBUCKET_REPO_FULL_NAME`

## 🔧 Development

### Prerequisites

- Node.js >= 18.0.0
- Docker Engine
- npm or yarn

### Setup

```bash
# Clone repository
git clone https://github.com/yohi/BitbucketPipelinesLocalRunner.git
cd BitbucketPipelinesLocalRunner

# Install dependencies
npm install

# Build project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

### Available Scripts

```bash
npm run build        # Compile TypeScript
npm run dev          # Development mode with ts-node
npm start            # Run compiled version
npm test             # Run Jest tests
npm run test:watch   # Watch mode testing
npm run test:e2e     # End-to-end tests
npm run lint         # ESLint checking
npm run lint:fix     # Auto-fix ESLint issues
npm run format       # Format code with Prettier
npm run clean        # Remove build output
```

## 🏗️ Architecture

### Core Components

- **BitbucketPipelinesRunner** - Main execution engine
- **DockerManager** - Docker container orchestration
- **YAMLParser** - Pipeline configuration parsing
- **CacheManager** - Build cache management
- **ArtifactManager** - Artifact handling
- **EnvironmentManager** - Environment variable management
- **ConfigManager** - Configuration management
- **PipelineValidator** - Configuration validation

### Project Structure

```
src/
├── cli.ts                    # CLI entry point
├── index.ts                  # Main module exports
├── core/
│   ├── runner.ts            # Pipeline execution engine
│   ├── validator.ts         # Configuration validation
│   └── yaml-parser.ts       # YAML parsing logic
├── managers/
│   ├── artifact-manager.ts   # Artifact handling
│   ├── cache-manager.ts      # Cache operations
│   ├── config-manager.ts     # Configuration management
│   ├── docker-manager.ts     # Docker operations
│   └── environment-manager.ts # Environment variables
├── interfaces/
│   └── index.ts             # TypeScript interfaces
└── utils/
    └── logger.ts            # Logging utilities
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write tests for new features
- Use ESLint and Prettier for code formatting
- Update documentation for new features

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

- 📫 **Issues**: [GitHub Issues](https://github.com/yohi/BitbucketPipelinesLocalRunner/issues)
- 📖 **Documentation**: [Project Wiki](https://github.com/yohi/BitbucketPipelinesLocalRunner/wiki)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/yohi/BitbucketPipelinesLocalRunner/discussions)

## 🎯 Roadmap

- [ ] Web UI for pipeline management
- [ ] Integration with popular CI/CD tools
- [ ] Support for additional container runtimes
- [ ] Enhanced caching strategies
- [ ] Pipeline templates and presets

---

Made with ❤️ by [yohi](https://github.com/yohi)