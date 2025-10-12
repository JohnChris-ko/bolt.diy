import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { DockerManager } from '../docker-manager';
import { PortManager } from '../port-manager';
import { ErrorResponse } from '../types';

export function createPreviewRouter(
  dockerManager: DockerManager,
  portManager: PortManager
): express.Router {
  const router = express.Router();

  // GET /api/sessions/:sessionId/previews - List detected ports
  router.get('/:sessionId/previews', async (req, res) => {
    try {
      const { sessionId } = req.params;

      const portInfos = portManager.getDetectedPorts(sessionId);
      res.status(200).json({ servers: portInfos });
    } catch (error: any) {
      console.error('[PreviewRouter] Failed to get previews:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to get previews',
        code: 'PREVIEW_LIST_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // Proxy routes: /preview/:sessionId/:port/*
  router.use('/:sessionId/:port', async (req, res, next) => {
    try {
      const { sessionId, port } = req.params;
      const portNum = parseInt(port);

      if (isNaN(portNum)) {
        const error: ErrorResponse = {
          error: 'Invalid port number',
          code: 'INVALID_PORT',
        };
        return res.status(400).json(error);
      }

      // Get container IP
      const containerIP = await dockerManager.getContainerIP(sessionId);

      // Create proxy middleware
      const proxy = createProxyMiddleware({
        target: `http://${containerIP}:${portNum}`,
        changeOrigin: true,
        ws: true, // WebSocket support
        pathRewrite: (path) => {
          // Remove /preview/:sessionId/:port prefix
          return path.replace(`/preview/${sessionId}/${port}`, '');
        },
        onError: (err, req, res) => {
          console.error(`[PreviewRouter] Proxy error for session ${sessionId}:${port}:`, err.message);
          if (!res.headersSent) {
            const errorResponse: ErrorResponse = {
              error: 'Container not responding',
              code: 'CONTAINER_NOT_RESPONDING',
              details: err.message,
            };
            (res as express.Response).status(502).json(errorResponse);
          }
        },
        onProxyReq: (proxyReq, req) => {
          // Set headers as needed
          proxyReq.setHeader('X-Forwarded-For', req.socket.remoteAddress || '');
          proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
          proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '');
        },
      });

      proxy(req, res, next);
    } catch (error: any) {
      console.error('[PreviewRouter] Failed to create proxy:', error);

      if (error.message === 'Session not found') {
        const errorResponse: ErrorResponse = {
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        };
        return res.status(404).json(errorResponse);
      }

      const errorResponse: ErrorResponse = {
        error: 'Failed to proxy request',
        code: 'PROXY_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}
