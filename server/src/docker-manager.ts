import Dockerode from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import {
  SessionInfo,
  DockerConfig,
  ExecOptions,
  ExecResult,
} from './types';

export class DockerManager {
  private docker: Dockerode;
  private sessions: Map<string, SessionInfo> = new Map();
  private activityTimestamps: Map<string, number> = new Map();
  private readonly WORKDIR = '/project';
  private readonly STOP_TIMEOUT = 30;
  private readonly STOP_RETRY_ATTEMPTS = 3;
  private readonly STOP_RETRY_DELAY = 2000;
  private readonly DEFAULT_IMAGE = 'node:20-alpine';
  private readonly DEFAULT_MEMORY = '256m';
  private readonly DEFAULT_CPUS = 0.5;

  constructor() {
    const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
    this.docker = new Dockerode({ socketPath });
  }

  async createSession(projectId: string, baseImage?: string): Promise<SessionInfo> {
    const sessionId = uuidv4();
    const volumeName = `${sessionId}_workspace`;
    const image = baseImage || this.DEFAULT_IMAGE;

    // Check if running in production
    const isProduction = process.env.NODE_ENV === 'production';

    // Only inspect image in production
    if (isProduction) {
      try {
        await this.docker.getImage(image).inspect();
      } catch (error) {
        console.log(`[DockerManager] Pulling image ${image}...`);
        await new Promise((resolve, reject) => {
          this.docker.pull(image, (err: any, stream: any) => {
            if (err) return reject(err);
            this.docker.modem.followProgress(stream, (err: any) => {
              if (err) return reject(err);
              resolve(null);
            });
          });
        });
      }
    }

    // Create volume
    try {
      await this.docker.createVolume({ Name: volumeName });
    } catch (error: any) {
      if (error.statusCode === 409) {
        console.info(`[DockerManager] Volume ${volumeName} already exists, continuing...`);
      } else {
        throw error;
      }
    }

    // Parse memory limit
    const memoryLimit = this.parseMemoryLimit(
      process.env.CONTAINER_MEMORY_LIMIT || this.DEFAULT_MEMORY
    );

    // Create container with dynamic port allocation
    const container = await this.docker.createContainer({
      Image: image,
      Cmd: ['/bin/sh', '-c', 'tail -f /dev/null'],
      WorkingDir: this.WORKDIR,
      Labels: {
        'bolt.session': sessionId,
        'bolt.project': projectId,
      },
      HostConfig: {
        Memory: memoryLimit,
        NanoCpus: Math.floor((process.env.CONTAINER_CPU_LIMIT ? parseFloat(process.env.CONTAINER_CPU_LIMIT) : this.DEFAULT_CPUS) * 1e9),
        Binds: [`${volumeName}:${this.WORKDIR}`],
        PublishAllPorts: true, // Dynamic port allocation with -P flag
      },
      ExposedPorts: {
        // Expose common dev ports for dynamic mapping
        '3000/tcp': {},
        '5173/tcp': {},
        '8080/tcp': {},
      },
    });

    await container.start();

    const sessionInfo: SessionInfo = {
      sessionId,
      containerId: container.id,
      status: 'running',
      workdir: this.WORKDIR,
      uptime: Date.now(),
      lastActivity: new Date().toISOString(),
    };

    this.sessions.set(sessionId, sessionInfo);
    this.activityTimestamps.set(sessionId, Date.now());

    return sessionInfo;
  }

  getSession(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId) || null;
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const container = this.docker.getContainer(session.containerId);

    // Stop with retry logic
    let stopped = false;
    for (let attempt = 1; attempt <= this.STOP_RETRY_ATTEMPTS; attempt++) {
      try {
        await container.stop({ t: this.STOP_TIMEOUT });
        stopped = true;
        break;
      } catch (error: any) {
        console.error(`[DockerManager] Stop attempt ${attempt} failed:`, error.message);
        if (attempt < this.STOP_RETRY_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, this.STOP_RETRY_DELAY));
        }
      }
    }

    if (!stopped) {
      console.error(`[DockerManager] Failed to stop container after ${this.STOP_RETRY_ATTEMPTS} attempts`);
    }

    // Remove container gracefully, fallback to force
    try {
      await container.remove({ force: false });
    } catch (error) {
      console.warn(`[DockerManager] Graceful removal failed, forcing removal...`);
      await container.remove({ force: true });
    }

    // Remove volume if configured
    const removeVolumes = process.env.REMOVE_VOLUMES_ON_STOP === 'true';
    if (removeVolumes) {
      const volumeName = `${sessionId}_workspace`;
      try {
        const volume = this.docker.getVolume(volumeName);
        await volume.remove();
      } catch (error: any) {
        console.error(`[DockerManager] Failed to remove volume ${volumeName}:`, error.message);
      }
    }

    this.sessions.delete(sessionId);
    this.activityTimestamps.delete(sessionId);
  }

  async restartSession(sessionId: string): Promise<SessionInfo> {
    const oldSession = this.sessions.get(sessionId);
    if (!oldSession) {
      throw new Error('Session not found');
    }

    // Extract project ID from labels
    const container = this.docker.getContainer(oldSession.containerId);
    const containerInfo = await container.inspect();
    const projectId = containerInfo.Config.Labels?.['bolt.project'] ||
                     `${sessionId.substring(0, 8)}-${Date.now()}`;

    // Stop and remove old container (keep volume)
    try {
      await container.stop({ t: this.STOP_TIMEOUT });
    } catch (error) {
      console.warn('[DockerManager] Container already stopped');
    }

    try {
      await container.remove({ force: false });
    } catch (error) {
      await container.remove({ force: true });
    }

    this.sessions.delete(sessionId);
    this.activityTimestamps.delete(sessionId);

    // Create new session with same volume
    const volumeName = `${sessionId}_workspace`;
    const newSessionId = uuidv4();
    const image = containerInfo.Config.Image || this.DEFAULT_IMAGE;

    const newContainer = await this.docker.createContainer({
      Image: image,
      Cmd: ['/bin/sh', '-c', 'tail -f /dev/null'],
      WorkingDir: this.WORKDIR,
      Labels: {
        'bolt.session': newSessionId,
        'bolt.project': projectId,
      },
      HostConfig: {
        Memory: containerInfo.HostConfig.Memory || this.parseMemoryLimit(this.DEFAULT_MEMORY),
        NanoCpus: containerInfo.HostConfig.NanoCpus || Math.floor(this.DEFAULT_CPUS * 1e9),
        Binds: [`${volumeName}:${this.WORKDIR}`],
        PublishAllPorts: true,
      },
      ExposedPorts: {
        '3000/tcp': {},
        '5173/tcp': {},
        '8080/tcp': {},
      },
    });

    await newContainer.start();

    const newSessionInfo: SessionInfo = {
      sessionId: newSessionId,
      containerId: newContainer.id,
      status: 'running',
      workdir: this.WORKDIR,
      uptime: Date.now(),
      lastActivity: new Date().toISOString(),
    };

    this.sessions.set(newSessionId, newSessionInfo);
    this.activityTimestamps.set(newSessionId, Date.now());

    return newSessionInfo;
  }

  updateActivity(sessionId: string): void {
    this.activityTimestamps.set(sessionId, Date.now());
  }

  async execCommand(
    sessionId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const container = this.docker.getContainer(session.containerId);
    const startTime = Date.now();

    // Parse command into array
    const cmdArray = ['/bin/sh', '-c', command];

    // Create exec instance using dockerode's native API
    const exec = await container.exec({
      Cmd: cmdArray,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: !!opts?.stdin,
      WorkingDir: opts?.cwd || this.WORKDIR,
      Env: opts?.env ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) : undefined,
    });

    // Start exec and capture output
    const stream = await exec.start({
      hijack: !!opts?.stdin,
      stdin: !!opts?.stdin,
    });

    let stdout = '';
    let stderr = '';

    // Use dockerode's modem.demuxStream for stream handling
    const stdoutStream = new (require('stream').Writable)({
      write(chunk: Buffer, encoding: string, callback: () => void) {
        stdout += chunk.toString();
        callback();
      },
    });

    const stderrStream = new (require('stream').Writable)({
      write(chunk: Buffer, encoding: string, callback: () => void) {
        stderr += chunk.toString();
        callback();
      },
    });

    // Handle stdin if provided
    if (opts?.stdin && typeof stream === 'object' && 'write' in stream) {
      stream.write(opts.stdin);
      stream.end();
    }

    // Demultiplex streams
    if (typeof stream === 'object' && 'pipe' in stream) {
      this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);
    }

    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      if (typeof stream === 'object' && 'on' in stream) {
        stream.on('end', resolve);
        stream.on('error', reject);
      } else {
        resolve();
      }
    });

    // Get exit code
    const inspectData = await exec.inspect();
    const exitCode = inspectData.ExitCode || 0;
    const duration = Date.now() - startTime;

    return {
      exitCode,
      stdout,
      stderr,
      duration,
    };
  }

  async getContainerIP(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const container = this.docker.getContainer(session.containerId);
    const info = await container.inspect();

    return info.NetworkSettings.IPAddress || 'localhost';
  }

  async detectPorts(sessionId: string): Promise<number[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const container = this.docker.getContainer(session.containerId);
    const info = await container.inspect();

    // Get ports from Docker inspect
    const dockerPorts: number[] = [];
    if (info.NetworkSettings.Ports) {
      for (const [containerPort, hostBindings] of Object.entries(info.NetworkSettings.Ports)) {
        if (hostBindings && Array.isArray(hostBindings)) {
          const port = parseInt(containerPort.split('/')[0]);
          const hostPort = parseInt(hostBindings[0]?.HostPort);
          if (!isNaN(hostPort)) {
            dockerPorts.push(hostPort);
          }
        }
      }
    }

    // Verify with netstat
    try {
      const result = await this.execCommand(
        sessionId,
        'netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null || echo "NO_NETSTAT"'
      );

      const verifiedPorts: number[] = [];
      const lines = result.stdout.split('\n');

      for (const line of lines) {
        const match = line.match(/:(\d+)\s/);
        if (match) {
          const port = parseInt(match[1]);
          // Focus on 8000-10000 range as priority
          if (port >= 8000 && port <= 10000) {
            verifiedPorts.push(port);
          } else if (port >= 3000 && port <= 9999) {
            verifiedPorts.push(port);
          }
        }
      }

      // Combine and deduplicate
      const allPorts = [...new Set([...dockerPorts, ...verifiedPorts])];
      return allPorts.sort((a, b) => a - b);
    } catch (error) {
      console.warn('[DockerManager] Port verification failed, using Docker inspect only');
      return dockerPorts;
    }
  }

  async cleanupIdleSessions(): Promise<void> {
    const idleTimeout = parseInt(process.env.IDLE_TIMEOUT || '1800000'); // 30 minutes default
    const now = Date.now();

    for (const [sessionId, lastActivity] of this.activityTimestamps.entries()) {
      if (now - lastActivity > idleTimeout) {
        console.log(`[DockerManager] Cleaning up idle session: ${sessionId}`);
        try {
          await this.stopSession(sessionId);
        } catch (error: any) {
          console.error(`[DockerManager] Failed to cleanup session ${sessionId}:`, error.message);
        }
      }
    }
  }

  private parseMemoryLimit(limit: string): number {
    const units: Record<string, number> = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    const match = limit.toLowerCase().match(/^(\d+)([bkmg]?)$/);
    if (!match) {
      throw new Error(`Invalid memory limit format: ${limit}`);
    }

    const value = parseInt(match[1]);
    const unit = match[2] || 'b';

    return value * units[unit];
  }
}
