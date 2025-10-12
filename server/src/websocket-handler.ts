import { WebSocketServer, WebSocket } from 'ws';
import { DockerManager } from './docker-manager';
import { IncomingMessage } from 'http';
import Dockerode from 'dockerode';

interface TerminalMessage {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

export function setupWebSocketServer(
  wss: WebSocketServer,
  dockerManager: DockerManager
): void {
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    try {
      // Parse sessionId from URL path: /ws/terminal/:sessionId
      const urlPath = req.url || '';
      const match = urlPath.match(/\/ws\/terminal\/([^\/]+)/);

      if (!match) {
        console.error('[WebSocketHandler] Invalid URL format');
        ws.close(1008, 'Invalid URL format');
        return;
      }

      const sessionId = match[1];

      // Validate session exists
      const session = dockerManager.getSession(sessionId);
      if (!session) {
        console.error(`[WebSocketHandler] Session not found: ${sessionId}`);
        ws.close(1008, 'Session not found');
        return;
      }

      console.log(`[WebSocketHandler] Terminal connected for session: ${sessionId}`);

      // Get container
      const docker = (dockerManager as any).docker as Dockerode;
      const container = docker.getContainer(session.containerId);

      // Create interactive exec instance
      const exec = await container.exec({
        Cmd: ['/bin/sh'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });

      // Start exec and get stream
      const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
      });

      // Handle stream data -> WebSocket
      stream.on('data', (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          const message = JSON.stringify({
            type: 'output',
            data: chunk.toString('utf-8'),
          });
          ws.send(message);
        }
      });

      // Handle stream end
      stream.on('end', () => {
        console.log(`[WebSocketHandler] Shell ended for session: ${sessionId}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Shell terminated');
        }
      });

      // Handle stream errors
      stream.on('error', (error: Error) => {
        console.error(`[WebSocketHandler] Stream error for session ${sessionId}:`, error);
        if (ws.readyState === WebSocket.OPEN) {
          const message = JSON.stringify({
            type: 'error',
            data: `Stream error: ${error.message}`,
          });
          ws.send(message);
          ws.close(1011, 'Stream error');
        }
      });

      // Handle WebSocket messages -> stream
      ws.on('message', (data: Buffer) => {
        try {
          const message: TerminalMessage = JSON.parse(data.toString());

          if (message.type === 'input' && message.data !== undefined) {
            // Write input to shell
            stream.write(message.data);
          } else if (message.type === 'resize' && message.cols && message.rows) {
            // Resize TTY
            exec.resize({ h: message.rows, w: message.cols }).catch((err: Error) => {
              console.error(`[WebSocketHandler] Failed to resize TTY:`, err.message);
            });
          }
        } catch (error: any) {
          console.error('[WebSocketHandler] Failed to parse message:', error);
        }
      });

      // Handle WebSocket close
      ws.on('close', () => {
        console.log(`[WebSocketHandler] WebSocket closed for session: ${sessionId}`);

        // Gracefully terminate shell
        try {
          stream.write('exit\n');
          setTimeout(() => {
            if (!stream.destroyed) {
              stream.destroy();
            }
          }, 5000); // Wait 5 seconds before force kill
        } catch (error: any) {
          console.error('[WebSocketHandler] Error during cleanup:', error.message);
          stream.destroy();
        }
      });

      // Handle WebSocket errors
      ws.on('error', (error: Error) => {
        console.error(`[WebSocketHandler] WebSocket error for session ${sessionId}:`, error);
        if (!stream.destroyed) {
          stream.destroy();
        }
      });
    } catch (error: any) {
      console.error('[WebSocketHandler] Failed to setup terminal:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, `Setup failed: ${error.message}`);
      }
    }
  });

  console.log('[WebSocketHandler] WebSocket server initialized');
}
