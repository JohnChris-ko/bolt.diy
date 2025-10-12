import express from 'express';
import { DockerManager } from '../docker-manager';
import { ErrorResponse, FileWriteRequest, MkdirRequest, RemoveRequest } from '../types';

export function createFsRouter(dockerManager: DockerManager): express.Router {
  const router = express.Router();
  const WORKDIR = '/project';

  // POST /api/sessions/:sessionId/fs/write - Write file
  router.post('/:sessionId/write', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path, content, encoding }: FileWriteRequest = req.body;

      if (!path || content === undefined) {
        const error: ErrorResponse = {
          error: 'path and content are required',
          code: 'MISSING_PARAMETERS',
        };
        return res.status(400).json(error);
      }

      if (!path.startsWith(WORKDIR)) {
        const error: ErrorResponse = {
          error: `Path must start with ${WORKDIR}`,
          code: 'INVALID_PATH',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      // Ensure parent directory exists
      const parentDir = path.substring(0, path.lastIndexOf('/'));
      if (parentDir && parentDir !== WORKDIR) {
        await dockerManager.execCommand(sessionId, `mkdir -p "${parentDir}"`);
      }

      // Write file using cat with stdin
      await dockerManager.execCommand(
        sessionId,
        `cat > "${path}"`,
        { stdin: content }
      );

      res.status(200).json({ success: true, path });
    } catch (error: any) {
      console.error('[FsRouter] Failed to write file:', error);
      const errorResponse: ErrorResponse = {
        error: 'Unable to save your file',
        code: 'FILE_WRITE_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // POST /api/sessions/:sessionId/fs/mkdir - Make directory
  router.post('/:sessionId/mkdir', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path, recursive }: MkdirRequest = req.body;

      if (!path) {
        const error: ErrorResponse = {
          error: 'path is required',
          code: 'MISSING_PARAMETERS',
        };
        return res.status(400).json(error);
      }

      if (!path.startsWith(WORKDIR)) {
        const error: ErrorResponse = {
          error: `Path must start with ${WORKDIR}`,
          code: 'INVALID_PATH',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      const flags = recursive ? '-p' : '';
      await dockerManager.execCommand(sessionId, `mkdir ${flags} "${path}"`);

      res.status(200).json({ success: true, path });
    } catch (error: any) {
      console.error('[FsRouter] Failed to create directory:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to create directory',
        code: 'MKDIR_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // GET /api/sessions/:sessionId/fs/read - Read file
  router.get('/:sessionId/read', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const path = req.query.path as string;

      if (!path) {
        const error: ErrorResponse = {
          error: 'path query parameter is required',
          code: 'MISSING_PARAMETERS',
        };
        return res.status(400).json(error);
      }

      if (!path.startsWith(WORKDIR)) {
        const error: ErrorResponse = {
          error: `Path must start with ${WORKDIR}`,
          code: 'INVALID_PATH',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      const result = await dockerManager.execCommand(sessionId, `cat "${path}"`);

      if (result.exitCode !== 0) {
        const error: ErrorResponse = {
          error: 'File not found',
          code: 'FILE_NOT_FOUND',
          details: result.stderr,
        };
        return res.status(404).json(error);
      }

      res.status(200).json({ content: result.stdout });
    } catch (error: any) {
      console.error('[FsRouter] Failed to read file:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to read file',
        code: 'FILE_READ_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // GET /api/sessions/:sessionId/fs/readdir - Read directory
  router.get('/:sessionId/readdir', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const path = (req.query.path as string) || WORKDIR;

      if (!path.startsWith(WORKDIR)) {
        const error: ErrorResponse = {
          error: `Path must start with ${WORKDIR}`,
          code: 'INVALID_PATH',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      const result = await dockerManager.execCommand(
        sessionId,
        `ls -la "${path}" 2>/dev/null || echo "DIRECTORY_NOT_FOUND"`
      );

      if (result.stdout.includes('DIRECTORY_NOT_FOUND')) {
        const error: ErrorResponse = {
          error: 'Directory not found',
          code: 'DIRECTORY_NOT_FOUND',
        };
        return res.status(404).json(error);
      }

      // Parse ls -la output
      const lines = result.stdout.split('\n').slice(1); // Skip "total" line
      const entries = lines
        .filter(line => line.trim() && !line.includes('total'))
        .map(line => {
          const parts = line.split(/\s+/);
          if (parts.length < 9) return null;

          const permissions = parts[0];
          const size = parseInt(parts[4]) || 0;
          const name = parts.slice(8).join(' ');

          // Skip . and ..
          if (name === '.' || name === '..') return null;

          const type = permissions.startsWith('d') ? 'directory' : 'file';

          return { name, type, size };
        })
        .filter(entry => entry !== null);

      res.status(200).json({ entries });
    } catch (error: any) {
      console.error('[FsRouter] Failed to read directory:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to read directory',
        code: 'READDIR_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  // DELETE /api/sessions/:sessionId/fs/remove - Remove file/directory
  router.delete('/:sessionId/remove', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { path, recursive }: RemoveRequest = req.body;

      if (!path) {
        const error: ErrorResponse = {
          error: 'path is required',
          code: 'MISSING_PARAMETERS',
        };
        return res.status(400).json(error);
      }

      if (!path.startsWith(WORKDIR)) {
        const error: ErrorResponse = {
          error: `Path must start with ${WORKDIR}`,
          code: 'INVALID_PATH',
        };
        return res.status(400).json(error);
      }

      // Prevent removing the work directory itself
      if (path === WORKDIR) {
        const error: ErrorResponse = {
          error: 'Cannot remove the work directory',
          code: 'INVALID_OPERATION',
        };
        return res.status(400).json(error);
      }

      dockerManager.updateActivity(sessionId);

      const flags = recursive ? '-rf' : '';
      await dockerManager.execCommand(sessionId, `rm ${flags} "${path}"`);

      res.status(200).json({ success: true, path });
    } catch (error: any) {
      console.error('[FsRouter] Failed to remove:', error);
      const errorResponse: ErrorResponse = {
        error: 'Failed to remove file or directory',
        code: 'REMOVE_ERROR',
        details: error.message,
      };
      res.status(500).json(errorResponse);
    }
  });

  return router;
}
