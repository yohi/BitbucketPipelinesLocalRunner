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

### `validate` - 設定の検証

`bitbucket-pipelines.yml`設定ファイルを検証します。

```bash
bbpl validate [options]

オプション:
  -v, --verbose           詳細ログを有効にする
  --config <path>         設定ファイルのパス
```

### `list` - パイプライン一覧

設定内のすべての利用可能なパイプラインを表示します。

```bash
bbpl list [options]

オプション:
  -v, --verbose           詳細ログを有効にする
```

### `clean` - クリーンアップ

ローカルキャッシュとアーティファクトをクリーンアップします。

```bash
bbpl clean [options]

オプション:
  -v, --verbose           詳細ログを有効にする
  --cache                 キャッシュのみをクリア
  --artifacts             アーティファクトのみをクリア
```

### `init` - 設定の初期化

初期ローカルランナー設定ファイルを作成します。

```bash
bbpl init [options]

オプション:
  -v, --verbose           詳細ログを有効にする
```

## ⚙️ 設定

### ローカルランナー設定

プロジェクトルートに`.bitbucket-pipelines-local.yml`を作成します：

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

### 環境変数

このツールは標準的なBitbucket環境変数をサポートします：

- `BITBUCKET_BRANCH`
- `BITBUCKET_COMMIT`
- `BITBUCKET_BUILD_NUMBER`
- `BITBUCKET_REPO_SLUG`
- `BITBUCKET_WORKSPACE`
- `BITBUCKET_REPO_FULL_NAME`

## 🔧 開発

### 前提条件

- Node.js >= 18.0.0
- Docker Engine
- npmまたはyarn

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/yohi/BitbucketPipelinesLocalRunner.git
cd BitbucketPipelinesLocalRunner

# 依存関係をインストール
npm install

# プロジェクトをビルド
npm run build

# 開発モードで実行
npm run dev

# テストを実行
npm test
```

### 利用可能なスクリプト

```bash
npm run build        # TypeScriptをコンパイル
npm run dev          # ts-nodeで開発モード
npm start            # コンパイル済みバージョンを実行
npm test             # Jestテストを実行
npm run test:watch   # ウォッチモードテスト
npm run test:e2e     # エンドツーエンドテスト
npm run lint         # ESLintチェック
npm run lint:fix     # ESLint問題の自動修正
npm run format       # Prettierでコードフォーマット
npm run clean        # ビルド出力を削除
```

## 🏗️ アーキテクチャ

### コアコンポーネント

- **BitbucketPipelinesRunner** - メイン実行エンジン
- **DockerManager** - Dockerコンテナオーケストレーション
- **YAMLParser** - パイプライン設定解析
- **CacheManager** - ビルドキャッシュ管理
- **ArtifactManager** - アーティファクト処理
- **EnvironmentManager** - 環境変数管理
- **ConfigManager** - 設定管理
- **PipelineValidator** - 設定検証

### プロジェクト構造

```
src/
├── cli.ts                    # CLIエントリーポイント
├── index.ts                  # メインモジュールエクスポート
├── core/
│   ├── runner.ts            # パイプライン実行エンジン
│   ├── validator.ts         # 設定検証
│   └── yaml-parser.ts       # YAML解析ロジック
├── managers/
│   ├── artifact-manager.ts   # アーティファクト処理
│   ├── cache-manager.ts      # キャッシュ操作
│   ├── config-manager.ts     # 設定管理
│   ├── docker-manager.ts     # Docker操作
│   └── environment-manager.ts # 環境変数
├── interfaces/
│   └── index.ts             # TypeScriptインターフェース
└── utils/
    └── logger.ts            # ログユーティリティ
```

## 🤝 コントリビューション

1. リポジトリをフォークする
2. フィーチャーブランチを作成する (`git checkout -b feature/amazing-feature`)
3. 変更をコミットする (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュする (`git push origin feature/amazing-feature`)
5. プルリクエストを開く

### 開発ガイドライン

- TypeScriptのベストプラクティスに従う
- 新機能にテストを書く
- コードフォーマットにESLintとPrettierを使用
- 新機能のドキュメントを更新する

## 📝 ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 🙋 サポート

- 📫 **Issues**: [GitHub Issues](https://github.com/yohi/BitbucketPipelinesLocalRunner/issues)
- 📖 **ドキュメント**: [Project Wiki](https://github.com/yohi/BitbucketPipelinesLocalRunner/wiki)
- 💬 **ディスカッション**: [GitHub Discussions](https://github.com/yohi/BitbucketPipelinesLocalRunner/discussions)

## 🎯 ロードマップ

- [ ] パイプライン管理用のWeb UI
- [ ] 人気のCI/CDツールとの統合
- [ ] 追加のコンテナランタイムのサポート
- [ ] 強化されたキャッシュ戦略
- [ ] パイプラインテンプレートとプリセット

---

❤️ で作られました by [yohi](https://github.com/yohi)
