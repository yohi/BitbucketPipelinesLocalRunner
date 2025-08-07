import Docker from 'dockerode';
import * as path from 'path';
// import * as os from 'os';  // 将来的に使用予定
import { Logger } from '../utils/logger';
import {
  DockerManager as IDockerManager,
  DockerConfig,
  AuthConfig,
  ContainerConfig,
  Container,
  ContainerResult,
  Network,
  Step,
  ExecutionContext,
  PipelineError,
  ErrorType
} from '../interfaces';

export class DockerManager implements IDockerManager {
  private docker: Docker;
  private config: DockerConfig;
  private logger: Logger;
  private containers: Container[] = [];
  private networks: Network[] = [];

  constructor(config: DockerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    // Dockerクライアントを初期化
    this.docker = new Docker({
      socketPath: config.socketPath || '/var/run/docker.sock'
    });
  }

  /**
   * Dockerイメージをプル
   */
  async pullImage(image: string, auth?: AuthConfig): Promise<void> {
    try {
      this.logger.dockerInfo(`Pulling image: ${image}`);

      const authConfig = auth ? {
        username: auth.username,
        password: auth.password,
        email: auth.email,
        serveraddress: auth.serveraddress
      } : undefined;

      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, { authconfig: authConfig }, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }

          if (!stream) {
            reject(new Error('No stream returned from docker pull'));
            return;
          }

          this.docker.modem.followProgress(stream, (err, _res) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }, (event) => {
            if (event.status) {
              this.logger.debug(`Pull progress: ${event.status}${event.progress || ''}`);
            }
          });
        });
      });

      this.logger.dockerInfo(`Successfully pulled image: ${image}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to pull image ${image}: ${message}`);
      throw new PipelineError(ErrorType.DOCKER_ERROR, `Failed to pull image: ${message}`, error);
    }
  }

  /**
   * コンテナを作成
   */
  async createContainer(config: ContainerConfig): Promise<Container> {
    try {
      this.logger.dockerInfo(`Creating container with image: ${config.image}`);

      // ボリュームマウントの設定
      const binds = config.volumes.map(volume => {
        const source = path.resolve(volume.source);
        return `${source}:${volume.target}${volume.readonly ? ':ro' : ''}`;
      });

      // 環境変数の設定
      const env = Object.entries(config.environment).map(([key, value]) => `${key}=${value}`);

      // ポート設定
      const exposedPorts: Record<string, {}> = {};
      const portBindings: Record<string, Array<{ HostPort: string }>> = {};

      if (config.ports) {
        config.ports.forEach(port => {
          const containerPort = `${port.containerPort}/${port.protocol || 'tcp'}`;
          exposedPorts[containerPort] = {};

          if (port.hostPort) {
            portBindings[containerPort] = [{ HostPort: port.hostPort.toString() }];
          }
        });
      }

      // リソース制限の設定
      const hostConfig: any = {
        Binds: binds,
        NetworkMode: config.network,
        PortBindings: portBindings
      };

      if (config.memoryLimit) {
        hostConfig.Memory = this.parseMemoryLimit(config.memoryLimit);
      }

      if (config.cpuLimit) {
        hostConfig.NanoCpus = this.parseCpuLimit(config.cpuLimit);
      }

      // コンテナ作成設定
      const createConfig = {
        Image: config.image,
        Cmd: config.command,
        Env: env,
        WorkingDir: config.workingDir,
        ExposedPorts: exposedPorts,
        HostConfig: hostConfig,
        User: config.user,
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: false,
        Tty: false
      };

      this.logger.dockerCommand(`docker create ${JSON.stringify(createConfig, null, 2)}`);

      const dockerContainer = await this.docker.createContainer(createConfig);

      const container: Container = {
        id: dockerContainer.id,
        name: `bbpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        config,
        status: 'created'
      };

      this.containers.push(container);
      this.logger.dockerInfo(`Container created: ${container.id.substring(0, 12)}`);

      return container;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create container: ${message}`);
      throw new PipelineError(ErrorType.DOCKER_ERROR, `Failed to create container: ${message}`, error);
    }
  }

  /**
   * コンテナを実行
   */
  async runContainer(container: Container): Promise<ContainerResult> {
    const startTime = Date.now();

    try {
      this.logger.dockerInfo(`Starting container: ${container.id.substring(0, 12)}`);

      const dockerContainer = this.docker.getContainer(container.id);

      // コンテナを開始
      await dockerContainer.start();
      container.status = 'running';

      this.logger.dockerCommand(`docker start ${container.id.substring(0, 12)}`);

      // ログをストリーミング
      const logStream = await dockerContainer.logs({
        stdout: true,
        stderr: true,
        follow: true,
        timestamps: false
      });

      const output: string[] = [];
      let errorOutput = '';

      // ログを収集
      await new Promise<void>((resolve, reject) => {
        logStream.on('data', (chunk) => {
          const data = chunk.toString();
          // Docker のマルチプレックス形式を処理
          const cleanData = this.cleanDockerLogOutput(data);
          output.push(cleanData);

          // リアルタイム出力
          this.logger.containerOutput(cleanData, container.name);
        });

        logStream.on('error', (error) => {
          this.logger.error(`Log stream error: ${error.message}`);
          errorOutput = error.message;
        });

        logStream.on('end', () => {
          resolve();
        });

        // コンテナの終了を待機
        dockerContainer.wait((err, _data) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // 実行結果を取得
      const inspection = await dockerContainer.inspect();
      const exitCode = inspection.State.ExitCode || 0;

      container.status = exitCode === 0 ? 'exited' : 'exited';

      const duration = Date.now() - startTime;
      this.logger.dockerInfo(`Container finished: ${container.id.substring(0, 12)} (exit code: ${exitCode})`);

      return {
        exitCode,
        output,
        error: exitCode !== 0 ? (errorOutput || `Container exited with code ${exitCode}`) : undefined,
        duration
      };

    } catch (error) {
      container.status = 'exited';
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Container execution failed: ${message}`);

      return {
        exitCode: 1,
        output: [],
        error: message,
        duration
      };
    }
  }

  /**
   * ステップコンテナを実行（高レベル API）
   */
  async runStepContainer(step: Step, context: ExecutionContext): Promise<ContainerResult> {
    try {
      // 使用するイメージを決定
      let image: string;
      if (typeof step.image === 'string') {
        image = step.image;
      } else if (step.image && typeof step.image === 'object') {
        image = step.image.name;
      } else {
        image = this.config.defaultImage || 'atlassian/default-image:latest';
      }

      // イメージをプル
      await this.pullImage(image);

      // スクリプトを実行可能な形式に変換
      const script = step.script.join('\n');
      const scriptFile = '/tmp/bbpl-script.sh';

      // コンテナ設定を作成
      const containerConfig: ContainerConfig = {
        image,
        command: ['/bin/bash', '-c', `echo '${script.replace(/'/g, "'\\''")}' > ${scriptFile} && chmod +x ${scriptFile} && ${scriptFile}`],
        environment: context.environment,
        volumes: [
          {
            source: context.workspaceDir,
            target: '/opt/atlassian/pipelines/agent/build',
            readonly: false
          }
        ],
        workingDir: '/opt/atlassian/pipelines/agent/build',
        network: context.network || undefined,
        memoryLimit: this.getMemoryLimit(step.size) || undefined,
        cpuLimit: this.getCpuLimit(step.size) || undefined
      };

      // after-script がある場合の処理
      if (step.afterScript && step.afterScript.length > 0) {
        const afterScript = step.afterScript.join('\n');
        const afterScriptFile = '/tmp/bbpl-after-script.sh';

        // メインスクリプトに after-script の実行を追加
        containerConfig.command = [
          '/bin/bash', '-c',
          `echo '${script.replace(/'/g, "'\\''")}' > ${scriptFile} && ` +
          `echo '${afterScript.replace(/'/g, "'\\''")}' > ${afterScriptFile} && ` +
          `chmod +x ${scriptFile} ${afterScriptFile} && ` +
          `(${scriptFile}; exit_code=$?; ${afterScriptFile}; exit $exit_code)`
        ];
      }

      // コンテナを作成・実行
      const container = await this.createContainer(containerConfig);
      const result = await this.runContainer(container);

      // コンテナを削除
      await this.removeContainer(container.id);

      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new PipelineError(ErrorType.CONTAINER_ERROR, `Step execution failed: ${message}`, error);
    }
  }

  /**
   * コンテナを停止
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      this.logger.dockerInfo(`Stopping container: ${containerId.substring(0, 12)}`);

      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 }); // 10秒でタイムアウト

      this.logger.dockerCommand(`docker stop ${containerId.substring(0, 12)}`);
    } catch (error) {
      // コンテナが既に停止している場合はエラーを無視
      if (error instanceof Error && !error.message.includes('is not running')) {
        this.logger.error(`Failed to stop container: ${error.message}`);
      }
    }
  }

  /**
   * コンテナを削除
   */
  async removeContainer(containerId: string): Promise<void> {
    try {
      this.logger.dockerInfo(`Removing container: ${containerId.substring(0, 12)}`);

      const container = this.docker.getContainer(containerId);
      await container.remove({ force: true });

      // ローカルリストからも削除
      this.containers = this.containers.filter(c => c.id !== containerId);

      this.logger.dockerCommand(`docker rm -f ${containerId.substring(0, 12)}`);
    } catch (error) {
      this.logger.error(`Failed to remove container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * ネットワークを作成
   */
  async createNetwork(name: string): Promise<Network> {
    try {
      // 既存のネットワークをチェック
      const networks = await this.docker.listNetworks({ filters: { name: [name] } });

      if (networks.length > 0) {
        const existingNetwork = networks[0];
        if (existingNetwork) {
          this.logger.dockerInfo(`Using existing network: ${name}`);
          return {
            id: existingNetwork.Id || '',
            name: existingNetwork.Name || name
          };
        }
      }

      // 新しいネットワークを作成
      this.logger.dockerInfo(`Creating network: ${name}`);

      const dockerNetwork = await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        CheckDuplicate: true
      });

      const network: Network = {
        id: dockerNetwork.id,
        name
      };

      this.networks.push(network);
      this.logger.dockerCommand(`docker network create ${name}`);

      return network;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create network: ${message}`);
      throw new PipelineError(ErrorType.NETWORK_ERROR, `Failed to create network: ${message}`, error);
    }
  }

  /**
   * ネットワークを削除
   */
  async removeNetwork(networkId: string): Promise<void> {
    try {
      this.logger.dockerInfo(`Removing network: ${networkId.substring(0, 12)}`);

      const network = this.docker.getNetwork(networkId);
      await network.remove();

      // ローカルリストからも削除
      this.networks = this.networks.filter(n => n.id !== networkId);

      this.logger.dockerCommand(`docker network rm ${networkId.substring(0, 12)}`);
    } catch (error) {
      // ネットワークが使用中の場合はワーニングのみ
      if (error instanceof Error && error.message.includes('has active endpoints')) {
        this.logger.warning(`Network is still in use: ${networkId.substring(0, 12)}`);
      } else {
        this.logger.error(`Failed to remove network: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * コンテナ一覧を取得
   */
  async listContainers(): Promise<Container[]> {
    return this.containers;
  }

  /**
   * クリーンアップ処理
   */
  async cleanup(): Promise<void> {
    this.logger.debug('Cleaning up Docker resources...');

    // 実行中のコンテナを停止・削除
    for (const container of this.containers) {
      await this.stopContainer(container.id);
      await this.removeContainer(container.id);
    }

    // ネットワークを削除
    for (const network of this.networks) {
      if (network.name !== 'bbpl-network') { // メインネットワーク以外を削除
        await this.removeNetwork(network.id);
      }
    }

    this.containers = [];
    this.networks = [];
  }

  /**
   * メモリ制限を取得
   */
  private getMemoryLimit(size?: string): string | undefined {
    if (!size) return undefined;

    const limits = this.config.resourceLimits?.memory;
    return limits?.[size];
  }

  /**
   * CPU制限を取得
   */
  private getCpuLimit(size?: string): string | undefined {
    if (!size) return undefined;

    const limits = this.config.resourceLimits?.cpu;
    return limits?.[size];
  }

  /**
   * メモリ制限をバイト数に変換
   */
  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([kmg]?)$/i);
    if (!match || !match[1]) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2]?.toLowerCase() || '';

    switch (unit) {
      case 'k': return value * 1024;
      case 'm': return value * 1024 * 1024;
      case 'g': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  /**
   * CPU制限をナノCPUに変換
   */
  private parseCpuLimit(limit: string): number {
    const value = parseFloat(limit);
    return Math.floor(value * 1000000000); // CPUをナノCPUに変換
  }

  /**
   * Dockerログ出力をクリーンアップ
   */
  private cleanDockerLogOutput(data: string): string {
    // Docker のマルチプレックス形式のヘッダーを除去
    if (data.length >= 8) {
      const header = data.substring(0, 8);
      if (header[0] === '\u0001' || header[0] === '\u0002') {
        return data.substring(8);
      }
    }
    return data;
  }
}
