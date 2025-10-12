import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { DockerManager } from './docker-manager';
import { PortManager } from './port-manager';
import { createSessionsRouter } from './routes/sessions';
import { createFsRouter } from './routes/fs';
import { createExecRouter } from './routes/exec';
import { createPreviewRouter } from './routes/preview';
import { setupWebSocketServer } from './websocket-handler';

// Load environment variables
const PORT = parseInt(process.env.SERVER_PORT || '4000');
const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_INTERVAL || '300000'); // 5 minutes default

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Initialize managers
const dockerManager = new DockerManager();
const portManager = new PortManager(dockerManager);

// Mount routes
app.use('/api/sessions', createSessionsRouter(dockerManager));
app.use('/api/sessions', createFsRouter(dockerManager));
app.use('/api/sessions/:sessionId/exec', createExecRouter(dockerManager));
app.use('/api/sessions/:sessionId/previews', createPreviewRouter(dockerManager, portManager));
app.use('/preview', createPreviewRouter(dockerManager, portManager));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws/terminal',
});

// Setup WebSocket handling
setupWebSocketServer(wss, dockerManager);

// Setup cleanup interval
const cleanupInterval = setInterval(async () => {
  console.log('[Server] Running idle session cleanup...');
  try {
    await dockerManager.cleanupIdleSessions();
  } catch (error: any) {
    console.error('[Server] Cleanup failed:', error.message);
  }
}, CLEANUP_INTERVAL);

// Graceful shutdown handler
const shutdown = async () => {
  console.log('\n[Server] Shutting down gracefully...');

  // Clear cleanup interval
  clearInterval(cleanupInterval);

  // Close WebSocket server
  wss.close(() => {
    console.log('[Server] WebSocket server closed');
  });

  // Close HTTP server
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
  });

  // Stop all sessions
  console.log('[Server] Stopping all sessions...');
  // Note: In production, you might want to keep sessions running
  // For development, we clean them up

  console.log('[Server] Shutdown complete');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
const startServer = async () => {
  try {
    // Check Docker connectivity
    console.log('[Server] Checking Docker connectivity...');
    const docker = (dockerManager as any).docker;
    await docker.ping();
    console.log('[Server] Docker connection successful');

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`[Server] Backend server running on http://localhost:${PORT}`);
      console.log(`[Server] WebSocket server available at ws://localhost:${PORT}/ws/terminal/:sessionId`);
      console.log(`[Server] API available at http://localhost:${PORT}/api`);
      console.log(`[Server] Preview proxy available at http://localhost:${PORT}/preview/:sessionId/:port`);
    });
  } catch (error: any) {
    console.error('[Server] Failed to start server:', error.message);
    console.error('[Server] Make sure Docker is running and accessible');
    process.exit(1);
  }
};

startServer();
