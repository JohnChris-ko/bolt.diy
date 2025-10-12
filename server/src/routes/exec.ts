import express from 'express';
import { DockerManager } from '../docker-manager';
import { ErrorResponse, ExecRequest } from '../types';

export function createExecRouter(dockerManager: DockerManager): express.Router {
  const router = express.Router();

  // POST /api/sessions/:sessionId/exec - Execute command
  router.post('/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { command, cwd, env }: ExecRequest = req.body;

      if (!command) {
        const error: ErrorResponse = {
          error: 'command is required',
          code: 'MISSING_PARAMETERS',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      const result = await dockerManager.execCommand(sessionId, command, { cwd, env });

      res.status(200).json(result);
    } catch (error: any) {
      console.error('[ExecRouter] Failed to execute command:', error);

      if (error.message === 'Session not found') {
        const errorResponse: ErrorResponse = {
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        };
        return res.status(404).json(errorResponse);
      }

      const errorResponse: ErrorResponse = {
        error: 'Failed to execute command',
        code: 'EXEC_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}
