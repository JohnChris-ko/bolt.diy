import Docker from 'dockerode';
import express from 'express';
import WebSocket from 'ws';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Duplex } from 'stream';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const docker = new Docker(); // Connect to local Docker daemon

app.use(express.json());

// Store active containers by session ID (in-memory for simplicity; use DB for prod)
const sessions: Map<string, { container: Docker.Container; projectDir: string }> = new Map();

// API: Create a new project session and spin up Docker container
app.post('/api/create-session', async (req, res) => {
  const sessionId = uuidv4();
  const projectDir = path.resolve(process.cwd(), 'temp-projects', sessionId); // Local temp dir for project files
  await fs.ensureDir(projectDir);

  // Pull Node.js image if needed (use official open-source image)
  await docker.pull('node:20-alpine'); // Lightweight Node.js image

  // Create container with volume mount for project files
  const container = await docker.createContainer({
    Image: 'node:20-alpine',
    Tty: true,
    OpenStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      Binds: [`${projectDir}:/app`], // Mount local project dir to /app in container
      PortBindings: { '3000/tcp': [{ HostPort: '0' }] }, // Dynamic port for app preview
    },
    WorkingDir: '/app',
    Cmd: ['tail', '-f', '/dev/null'], // Keep container running idly
  });
  await container.start();

  sessions.set(sessionId, { container, projectDir });
  res.json({ sessionId, message: 'Session created' });
});

// API: Write file to project
app.post('/api/write-file/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, content } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const fullPath = path.join(session.projectDir, filePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content);
  res.json({ message: 'File written' });
});

// API: Read file from project
app.get('/api/read-file/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { filePath } = req.query;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (typeof filePath !== 'string') return res.status(400).json({ error: 'filePath query parameter is required' });

    const fullPath = path.join(session.projectDir, filePath);
    if (!await fs.pathExists(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content });
});

// API: List files in project
app.get('/api/list-files/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { path: reqPath } = req.query;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const dirPath = reqPath ? path.join(session.projectDir, reqPath as string) : session.projectDir;

    if (!await fs.pathExists(dirPath)) {
        return res.status(404).json({ error: 'Directory not found' });
    }

    try {
        const items = await fs.readdir(dirPath);
        const fileDetails = await Promise.all(items.map(async (item) => {
            const fullPath = path.join(dirPath, item);
            const stats = await fs.stat(fullPath);
            return {
                name: item,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
            };
        }));
        res.json({ files: fileDetails });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// API: Create directory
app.post('/api/mkdir/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { path: dirPath } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const fullPath = path.join(session.projectDir, dirPath);
    await fs.ensureDir(fullPath);
    res.json({ message: 'Directory created' });
});

// API: Remove file or directory
app.post('/api/rm/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { path: rmPath } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const fullPath = path.join(session.projectDir, rmPath);
    await fs.remove(fullPath);
    res.json({ message: 'Path removed' });
});

// WebSocket for streaming terminal output
const processes: Map<string, Map<string, { stream: Duplex, exec: Docker.Exec }>> = new Map();

wss.on('connection', (ws, req) => {
    const sessionId = req.url?.split('/')[1];
    if (!sessionId || !sessions.has(sessionId)) {
        ws.close(1011, 'Invalid session ID');
        return;
    }
    const session = sessions.get(sessionId)!;

    if (!processes.has(sessionId)) {
        processes.set(sessionId, new Map());
    }
    const sessionProcesses = processes.get(sessionId)!;

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message.toString());
            const { type, pid } = msg;

            if (type === 'spawn') {
                const { cmd, args } = msg;
                const exec = await session.container.exec({
                    Cmd: [cmd, ...(args || [])],
                    AttachStdout: true,
                    AttachStderr: true,
                    AttachStdin: true,
                    Tty: true,
                });

                const stream = await exec.start({ hijack: true, stdin: true });
                sessionProcesses.set(pid, { stream, exec });

                stream.on('data', (chunk) => {
                    ws.send(JSON.stringify({ type: 'stdout', pid, data: chunk.toString() }));
                });

                stream.on('end', () => {
                    exec.inspect((err, data) => {
                        ws.send(JSON.stringify({ type: 'exit', pid, code: data?.ExitCode ?? 0 }));
                        sessionProcesses.delete(pid);
                    });
                });

            } else if (type === 'stdin') {
                const { data } = msg;
                const process = sessionProcesses.get(pid);
                if (process) {
                    process.stream.write(data);
                }
            } else if (type === 'kill') {
                const process = sessionProcesses.get(pid);
                if (process) {
                    process.stream.end();
                }
            } else if (type === 'resize') {
                const { cols, rows } = msg;
                const process = sessionProcesses.get(pid);
                if (process) {
                    await process.exec.resize({ h: rows, w: cols });
                }
            }
        } catch (error: any) {
            console.error('WebSocket message error:', error);
            ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
    });

    ws.on('close', () => {
        sessionProcesses.forEach(p => p.stream.end());
        processes.delete(sessionId);
    });
});

// API: Get preview URL (proxy or direct)
app.get('/api/preview/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const info = await session.container.inspect();
  const portInfo = info.NetworkSettings.Ports['3000/tcp'];
  if (!portInfo || portInfo.length === 0) {
    return res.status(404).json({ error: 'Preview port not available' });
  }
  const port = portInfo[0].HostPort;
  res.json({ previewUrl: `http://localhost:${port}` });
});

// Cleanup on shutdown
process.on('SIGINT', async () => {
  for (const session of sessions.values()) {
    await session.container.stop();
    await session.container.remove();
    await fs.remove(session.projectDir);
  }
  process.exit(0);
});

server.listen(4000, () => console.log('Backend server on port 4000'));
