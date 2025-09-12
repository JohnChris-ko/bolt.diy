import { v4 as uuidv4 } from 'uuid';

type EventListener = (data: any) => void;

class DockerProcess {
  pid: string;
  output: ReadableStream<string>;
  input: WritableStream<string>;
  exit: Promise<number>;

  private outputController!: ReadableStreamDefaultController<string>;
  private exitPromiseResolver!: (code: number) => void;

  constructor(pid: string, ws: WebSocket) {
    this.pid = pid;

    this.output = new ReadableStream({
      start: (controller) => {
        this.outputController = controller;
      },
    });

    this.input = new WritableStream({
      write: (data) => {
        ws.send(JSON.stringify({ type: 'stdin', pid: this.pid, data }));
      },
    });

    this.exit = new Promise((resolve) => {
      this.exitPromiseResolver = resolve;
    });
  }

  handleOutput(data: string) {
    this.outputController.enqueue(data);
  }

  handleExit(code: number) {
    this.exitPromiseResolver(code);
    this.outputController.close();
  }

  kill() {
    this.ws.send(JSON.stringify({ type: 'kill', pid: this.pid }));
  }

  resize(cols: number, rows: number) {
    this.ws.send(JSON.stringify({ type: 'resize', pid: this.pid, cols, rows }));
  }
}

class DockerRuntime {
  public sessionId: string | null = null;
  private ws: WebSocket | null = null;
  private eventListeners: Map<string, EventListener[]> = new Map();
  private processes: Map<string, DockerProcess> = new Map();

  async boot(): Promise<this> {
    if (this.sessionId) return this;

    try {
      const response = await fetch('/api/create-session', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to create session');
      }
      const data = await response.json();
      this.sessionId = data.sessionId;
      this.connectWebSocket();

      return new Promise((resolve) => {
          this.on('open', () => resolve(this));
      });

    } catch (error) {
      console.error('Error booting DockerRuntime:', error);
      throw error;
    }
  }

  private connectWebSocket() {
    if (!this.sessionId) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.hostname}:4000/${this.sessionId}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.emit('open', null);
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const { type, pid, data, code, error } = msg;

      if (error) {
          console.error(`Error from backend for pid ${pid}:`, error);
          return;
      }

      const process = this.processes.get(pid);
      if (!process) return;

      if (type === 'stdout' || type === 'stderr') {
        process.handleOutput(data);
      } else if (type === 'exit') {
        process.handleExit(code);
        this.processes.delete(pid);
      }
    };

    this.ws.onclose = () => {
      this.emit('close', null);
    };

    this.ws.onerror = (err) => {
      this.emit('error', err);
      console.error('WebSocket error:', err);
    };
  }

  on(event: string, callback: EventListener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)?.push(callback);
  }

  private emit(event: string, data: any) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(l => l(data));
    }
  }

  get fs() {
    const fetchApi = async (endpoint: string, body: object) => {
        if (!this.sessionId) throw new Error('Session not initialized');
        const res = await fetch(`/api/${endpoint}/${this.sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: 'API request failed' }));
            throw new Error(errorData.error);
        }
        return res.json();
    }

    return {
      writeFile: async (path: string, content: string | Uint8Array) => {
        return fetchApi('write-file', { filePath: path, content: content.toString() });
      },
      readFile: async (path: string, encoding: 'utf-8' | undefined = undefined): Promise<string> => {
        if (!this.sessionId) throw new Error('Session not initialized');
        const response = await fetch(`/api/read-file/${this.sessionId}?filePath=${encodeURIComponent(path)}`);
        const data = await response.json();
        return data.content;
      },
      readdir: async (path: string, options?: any): Promise<any[]> => {
        if (!this.sessionId) throw new Error('Session not initialized');
        const response = await fetch(`/api/list-files/${this.sessionId}?path=${encodeURIComponent(path)}`);
        const data = await response.json();

        if (options?.withFileTypes) {
            return data.files.map((f: any) => ({
                name: f.name,
                isDirectory: () => f.isDirectory,
                isFile: () => f.isFile,
            }));
        }

        return data.files.map((f: any) => f.name);
      },
      mkdir: async(path: string) => {
          return fetchApi('mkdir', { path });
      },
      rm: async(path: string) => {
          return fetchApi('rm', { path });
      }
    };
  }

  async spawn(cmd: string, args: string[], options?: any) {
    if (!this.ws) throw new Error('WebSocket not connected');

    const pid = uuidv4();
    const process = new DockerProcess(pid, this.ws);
    this.processes.set(pid, process);

    this.ws.send(JSON.stringify({ type: 'spawn', pid, cmd, args }));

    return process;
  }
}

export const dockerRuntime = new DockerRuntime();
