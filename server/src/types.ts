export interface SessionInfo {
  sessionId: string;
  containerId: string;
  status: string;
  workdir: string;
  uptime: number;
  lastActivity: string;
}

export interface DockerConfig {
  image: string;
  memory: string;
  cpus: number;
  workdir: string;
}

export interface FileWriteRequest {
  path: string;
  content: string;
  encoding?: string;
}

export interface MkdirRequest {
  path: string;
  recursive?: boolean;
}

export interface RemoveRequest {
  path: string;
  recursive?: boolean;
}

export interface ExecRequest {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface PortInfo {
  port: number;
  proxyUrl: string;
  detected: string;
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: any;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}
