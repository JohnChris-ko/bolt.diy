# Migration Guide: WebContainer to Docker Runtime

This document explains the architectural changes made to bolt.diy to replace the proprietary WebContainer API with an open-source Docker-based runtime.

## Overview

**What Changed:**
- Replaced closed-source WebContainer with open-source Docker + Node.js backend
- Changed from browser-only execution to client-server architecture
- Removed dependency on `@webcontainer/api` package

**Why:**
- Full open-source stack (no proprietary dependencies)
- No commercial licensing requirements for WebContainer
- Better control over runtime environment
- Easier to extend and customize

## Architecture Changes

### Before (WebContainer)
```
Browser
  └── WebContainer (proprietary, in-browser Node.js runtime)
      └── Code execution, file system, terminal, preview servers
```

### After (Docker Runtime)
```
Browser (Frontend - React/Vite)
  ↓ HTTP/WebSocket
Backend (Node.js + Express)
  ↓ Docker API
Docker Containers (isolated Node.js environments)
  └── Code execution, file system, terminal, preview servers
```

## Key Components Added

### 1. Backend Server (`server/`)
- **Location**: `/server/src/`
- **Technology**: Express.js, WebSocket, Dockerode
- **Port**: 4000 (configurable)
- **Purpose**: Manages Docker containers, handles API requests, proxies preview servers

**Main files:**
- `index.ts` - Server entry point
- `docker-manager.ts` - Docker container lifecycle management
- `port-manager.ts` - Preview port detection and management
- `websocket-handler.ts` - Terminal WebSocket handling
- `routes/` - API endpoints for sessions, filesystem, exec, previews

### 2. Docker Runtime Client (`app/lib/runtime/docker-runtime.ts`)
- **Purpose**: Frontend client for communicating with backend
- **Replaces**: Direct WebContainer API calls
- **Methods**: createSession, writeFile, readFile, execCommand, etc.

### 3. Updated Stores
Modified to use Docker runtime instead of WebContainer:
- `FilesStore` - File operations via backend API
- `TerminalStore` - WebSocket-based terminal
- `PreviewsStore` - Polling-based preview detection

## Breaking Changes

### 1. Prerequisites
**New requirement**: Docker must be installed and running

**Installation steps:**
1. Install Docker Desktop
2. Ensure Docker is running: `docker ps`
3. Linux users: Add user to docker group

### 2. Environment Setup
**New environment files:**
- `server/.env` - Backend configuration
- `app/.env.local` - Frontend configuration (updated)

**Copy templates:**
```bash
cp server/.env.example server/.env
cp app/.env.local.example app/.env.local
```

### 3. Running the Application
**Changed command behavior:**
```bash
# Old: Started frontend only
pnpm run dev

# New: Starts both frontend and backend
pnpm run dev
# Frontend: http://localhost:5173
# Backend: http://localhost:4000
```

### 4. Store Constructors
**Changed signatures:**
```typescript
// Old
new FilesStore(webcontainerPromise: Promise<WebContainer>)
new TerminalStore(webcontainerPromise: Promise<WebContainer>)
new PreviewsStore(webcontainerPromise: Promise<WebContainer>)

// New
new FilesStore(sessionId: string)
new TerminalStore(sessionId: string)
new PreviewsStore(sessionId: string)
```

### 5. File Operations
**Changed from:**
```typescript
await webcontainer.fs.writeFile(path, content);
await webcontainer.fs.readFile(path);
```

**To:**
```typescript
await dockerRuntime.writeFile(sessionId, path, content);
await dockerRuntime.readFile(sessionId, path);
```

### 6. Terminal
**Changed from:**
```typescript
const process = await webcontainer.spawn(cmd, args);
// Stream handling with WebContainer process
```

**To:**
```typescript
const ws = dockerRuntime.createTerminalWebSocket(sessionId);
// WebSocket-based communication
```

### 7. Previews
**Changed from:**
```typescript
webcontainer.on('server-ready', (port, url) => {});
webcontainer.on('port', (port, type, url) => {});
```

**To:**
```typescript
// Polling-based detection
const portInfos = await dockerRuntime.getPreviewUrls(sessionId);
```

**URL format changed:**
- Old: `https://{id}.local-credentialless.webcontainer-api.io`
- New: `http://localhost:4000/preview/{sessionId}/{port}`

## Configuration Options

### Backend Environment Variables (`server/.env`)
```env
SERVER_PORT=4000              # Backend server port
DOCKER_SOCKET=/var/run/docker.sock
IDLE_TIMEOUT=1800000          # 30 minutes
CLEANUP_INTERVAL=300000       # 5 minutes
DEFAULT_CONTAINER_IMAGE=node:20-alpine
CONTAINER_MEMORY_LIMIT=256m
CONTAINER_CPU_LIMIT=0.5
REMOVE_VOLUMES_ON_STOP=false
```

### Frontend Environment Variables (`app/.env.local`)
```env
VITE_BACKEND_URL=http://localhost:4000
VITE_WS_BACKEND_URL=ws://localhost:4000
```

## Benefits of New Architecture

### 1. Fully Open Source
- No proprietary dependencies
- No licensing requirements for commercial use
- All components are open source (Docker, Node.js, Express)

### 2. Better Control
- Full control over container configuration
- Customize resource limits (CPU, memory)
- Choose any Docker base image
- Direct access to container filesystem

### 3. Extensibility
- Easy to add new API endpoints
- Can integrate with other backend services
- Support for additional languages/runtimes
- Custom container configurations per project

### 4. Security
- Container isolation
- Resource limits
- Network isolation options
- Volume management

## Known Limitations

### 1. Requires Docker
- Users must install Docker Desktop
- Docker must be running
- Requires ~2GB disk space for images

### 2. Session Management
- Sessions are server-side (not browser-only)
- Idle sessions cleaned up after timeout
- Volumes persist between sessions

### 3. Preview URLs
- Local only (localhost:4000)
- Not shareable outside local network
- Different format than WebContainer URLs

### 4. Performance
- Slight latency due to network calls
- Container startup time (~2-5 seconds)
- Polling-based file watching (2s interval)

## Remaining WebContainer References

The following files still contain WebContainer references and need manual updates:

### High Priority
- `app/lib/runtime/action-runner.ts` - AI action execution
- `app/lib/hooks/useGit.ts` - Git operations
- `app/components/workbench/Workbench.tsx` - Main workbench initialization

### Medium Priority
- `app/utils/shell.ts` - Shell process utilities
- `app/components/workbench/Search.tsx` - File search

### Low Priority (Can be removed)
- `app/lib/webcontainer/index.ts` - Old initialization
- `app/lib/webcontainer/auth.client.ts` - Auth client
- `app/routes/webcontainer.connect.$id.tsx` - Connection route

## Troubleshooting

### Docker Issues
**Permission denied:**
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

**Container won't stop:**
```bash
docker ps
docker rm -f <container_id>
```

**Image pull fails:**
```bash
docker pull node:20-alpine
```

### Backend Issues
**Port already in use:**
```bash
# Change SERVER_PORT in server/.env
```

**Backend not starting:**
```bash
# Check Docker is running
docker ps

# Check backend logs
cd server && npm run dev
```

### Frontend Issues
**Can't connect to backend:**
```bash
# Verify backend URL in app/.env.local
VITE_BACKEND_URL=http://localhost:4000
```

**Preview not loading:**
```bash
# Check backend proxy is working
curl http://localhost:4000/api/sessions/<sessionId>/previews
```

## Migration Checklist

- [ ] Install Docker Desktop
- [ ] Verify Docker is running: `docker ps`
- [ ] Copy environment files
- [ ] Install dependencies: `pnpm install`
- [ ] Update any custom code using WebContainer
- [ ] Test session creation
- [ ] Test file operations
- [ ] Test terminal
- [ ] Test preview servers
- [ ] Update deployment configuration (if applicable)

## Support

For issues or questions:
- Check the [FAQ](FAQ.md)
- Join our community at [oTTomator Think Tank](https://thinktank.ottomator.ai)
- File an issue on GitHub

## License

This Docker-based version is fully open source under the MIT license. No WebContainer commercial license is required.
