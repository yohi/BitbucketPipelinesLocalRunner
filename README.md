# Bitbucket Pipelines Local Runner

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue.svg)](https://www.typescriptlang.org/)

🚀 **Dockerを使ってパイプライン設定をローカルでテストできるBitbucket Pipelinesのローカルランナー**

## 📋 概要

Bitbucket Pipelines Local Runner (`bbpl`) は、開発者がリポジトリにプッシュすることなく、Bitbucket Pipelinesの設定をローカルで実行・テストできるコマンドラインツールです。このツールは、開発プロセスの早い段階で問題を発見し、CI/CDのフィードバックループを短縮するのに役立ちます。

## ✨ 機能

- 🐳 **Docker統合** - 分離されたDockerコンテナでパイプラインを実行
- ⚡ **高速フィードバック** - リポジトリにコミットすることなくパイプラインの変更をテスト
- 💾 **キャッシュ管理** - 実行を高速化するビルドキャッシュをサポート
- 📦 **アーティファクト処理** - パイプラインアーティファクトの保存と復元
- 🔍 **設定検証** - `bitbucket-pipelines.yml`の構文と構造を検証
- 🧪 **ドライランモード** - コマンドを実行せずにパイプライン実行をプレビュー
- 📊 **包括的ログ** - 複数の詳細レベルでの詳細な実行ログ
- ⚙️ **環境変数** - 環境変数管理の完全サポート
- 🔄 **並列実行** - 並列パイプラインステップのサポート

## 🚀 クイックスタート

### インストール

```bash
npm install -g bitbucket-pipelines-local-runner
```

またはnpxで直接実行：

```bash
npx bitbucket-pipelines-local-runner
```

### 基本的な使用方法

```bash
# デフォルトパイプラインを実行
bbpl run

# 特定のパイプラインを実行
bbpl run --pipeline custom/deployment

# ブランチ固有のパイプラインを実行
bbpl run --branch develop

# 設定を検証
bbpl validate

# 利用可能なパイプラインを一覧表示
bbpl list

# 設定を初期化
bbpl init
```

## 📖 コマンド

### `run` - パイプラインの実行

Dockerコンテナを使用してパイプラインをローカルで実行します。

```bash
bbpl run [options]

オプション:
  -p, --pipeline <name>    パイプライン名 (default、branch、またはcustom)
  -b, --branch <name>      ブランチ固有パイプライン用のブランチ名
  -c, --custom <name>      カスタムパイプライン名
  -v, --verbose            詳細ログを有効にする
  -d, --dry-run           コマンドを実行せずにドライランを実行
  --config <path>         設定ファイルのパス
  --env-file <path>       環境変数ファイルのパス
```

**例：**
```bash
# デフォルトパイプラインを実行
bbpl run

# 詳細ログ付きでカスタムパイプラインを実行
bbpl run --custom deployment --verbose

# テスト用のドライラン
bbpl run --dry-run --verbose

# カスタム設定と環境ファイルを使用
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