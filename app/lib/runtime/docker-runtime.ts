// Docker-based runtime client for Bolt.diy
// Replaces WebContainer with backend API calls

export interface SessionInfo {
  sessionId: string;
  containerId: string;
  status: string;
  workdir: string;
  uptime: number;
  lastActivity: string;
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

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const WS_URL = import.meta.env.VITE_WS_BACKEND_URL || 'ws://localhost:4000';

class DockerRuntime {
  async createSession(projectId: string): Promise<SessionInfo> {
    const response = await fetch(`${BACKEND_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create session');
    }

    return response.json();
  }

  async writeFile(sessionId: string, path: string, content: string): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to write file');
    }
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    const response = await fetch(
      `${BACKEND_URL}/api/sessions/${sessionId}/read?path=${encodeURIComponent(path)}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to read file');
    }

    const data = await response.json();
    return data.content;
  }

  async readdir(
    sessionId: string,
    path: string
  ): Promise<Array<{ name: string; type: string; size: number }>> {
    const response = await fetch(
      `${BACKEND_URL}/api/sessions/${sessionId}/readdir?path=${encodeURIComponent(path)}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to read directory');
    }

    const data = await response.json();
    return data.entries;
  }

  async mkdir(sessionId: string, path: string, recursive?: boolean): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, recursive }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create directory');
    }
  }

  async removeFile(sessionId: string, path: string, recursive?: boolean): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/remove`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, recursive }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to remove file');
    }
  }

  async execCommand(sessionId: string, command: string, opts?: any): Promise<ExecResult> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...opts }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to execute command');
    }

    return response.json();
  }

  async getPreviewUrls(sessionId: string): Promise<PortInfo[]> {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/previews`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get preview URLs');
    }

    const data = await response.json();
    return data.servers;
  }

  createTerminalWebSocket(sessionId: string): WebSocket {
    return new WebSocket(`${WS_URL}/ws/terminal/${sessionId}`);
  }
}

export const dockerRuntime = new DockerRuntime();
