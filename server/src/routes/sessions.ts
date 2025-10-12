import express from 'express';
import { DockerManager } from '../docker-manager';
import { ErrorResponse } from '../types';

export function createSessionsRouter(dockerManager: DockerManager): express.Router {
  const router = express.Router();

  // POST /api/sessions - Create new session
  router.post('/', async (req, res) => {
    try {
      const { projectId, baseImage } = req.body;

      if (!projectId) {
        const error: ErrorResponse = {
          error: 'projectId is required',
          code: 'MISSING_PROJECT_ID',
        };
        return res.status(400).json(error);
      }

      const sessionInfo = await dockerManager.createSession(projectId, baseImage);
      res.status(201).json(sessionInfo);
    } catch (error: any) {
      console.error('[SessionsRouter] Failed to create session:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to create session',
        code: 'SESSION_CREATE_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // GET /api/sessions/:sessionId - Get session info
  router.get('/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const sessionInfo = dockerManager.getSession(sessionId);

      if (!sessionInfo) {
        const error: ErrorResponse = {
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        };
        return res.status(404).json(error);
      }

      res.status(200).json(sessionInfo);
    } catch (error: any) {
      console.error('[SessionsRouter] Failed to get session:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to get session',
        code: 'SESSION_GET_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // DELETE /api/sessions/:sessionId - Stop session
  router.delete('/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;

      await dockerManager.stopSession(sessionId);
      res.status(200).json({ success: true, message: 'Session stopped' });
    } catch (error: any) {
      console.error('[SessionsRouter] Failed to stop session:', error);

      if (error.message === 'Session not found') {
        const errorResponse: ErrorResponse = {
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        };
        return res.status(404).json(errorResponse);
      }

      const errorResponse: ErrorResponse = {
        error: 'Failed to stop session',
        code: 'SESSION_STOP_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // POST /api/sessions/:sessionId/restart - Restart session
  router.post('/:sessionId/restart', async (req, res) => {
    try {
      const { sessionId } = req.params;

      const newSessionInfo = await dockerManager.restartSession(sessionId);
      res.status(200).json(newSessionInfo);
    } catch (error: any) {
      console.error('[SessionsRouter] Failed to restart session:', error);

      if (error.message === 'Session not found') {
        const errorResponse: ErrorResponse = {
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        };
        return res.status(404).json(errorResponse);
      }

      const errorResponse: ErrorResponse = {
        error: 'Failed to restart session',
        code: 'SESSION_RESTART_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}
