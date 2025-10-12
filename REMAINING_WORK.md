# Remaining Work: WebContainer to Docker Migration

This document tracks the remaining files and components that still need to be updated to complete the migration from WebContainer to the Docker-based runtime.

## Status Summary

### ✅ Completed
- Backend server implementation (Express, Docker, WebSocket)
- Docker runtime client (`app/lib/runtime/docker-runtime.ts`)
- Core stores: FilesStore, TerminalStore, PreviewsStore
- Environment configuration and documentation
- README updates with Docker prerequisites
- Migration guide (MIGRATION.md)

### ⚠️ Partially Complete
- Frontend stores updated but not fully tested
- File watching uses polling (2s interval) instead of real-time events

### ❌ Not Started
- Action runner updates
- Git hook updates
- Workbench initialization updates
- Shell utilities updates
- Legacy WebContainer files removal
- Integration testing

## Files Requiring Updates

### HIGH PRIORITY - Core Functionality

#### 1. `app/lib/runtime/action-runner.ts`
**Status**: Not started
**Why**: This file executes AI-generated actions (file writes, shell commands)
**Current**: Uses WebContainer spawn and fs methods
**Needs**:
- Replace `webcontainer.spawn()` with `dockerRuntime.execCommand()`
- Replace `webcontainer.fs.*` with `dockerRuntime.*`
- Add `sessionId` parameter to all action functions
- Update error handling for Docker API responses

**Example changes:**
```typescript
// Old
await webcontainer.spawn('npm', ['install']);

// New
await dockerRuntime.execCommand(sessionId, 'npm install');
```

#### 2. `app/lib/hooks/useGit.ts`
**Status**: Not started
**Why**: Git operations need filesystem access
**Current**: Wraps WebContainer fs for isomorphic-git
**Needs**:
- Replace filesystem wrapper with dockerRuntime calls
- Add sessionId to hook dependencies
- Update all file read/write operations
- Test with actual git operations

**Impact**: Git clone, commit, push/pull functionality

#### 3. `app/components/workbench/Workbench.tsx` (or main workbench file)
**Status**: Not started
**Why**: Main application component that initializes runtime
**Current**: Initializes WebContainer and passes to stores
**Needs**:
- Create session on mount: `const session = await dockerRuntime.createSession(projectId)`
- Pass `sessionId` to stores instead of webcontainerPromise
- Add loading state during session creation
- Handle session creation errors
- Add session cleanup on unmount

**Example:**
```typescript
useEffect(() => {
  const initSession = async () => {
    try {
      const projectId = getCurrentProjectId(); // from URL or props
      const session = await dockerRuntime.createSession(projectId);
      setSessionId(session.sessionId);

      // Initialize stores with sessionId
      const filesStore = new FilesStore(session.sessionId);
      const terminalStore = new TerminalStore(session.sessionId);
      const previewsStore = new PreviewsStore(session.sessionId);

    } catch (error) {
      console.error('Failed to create session:', error);
      // Show error to user
    }
  };

  initSession();
}, []);
```

### MEDIUM PRIORITY - Supporting Features

#### 4. `app/utils/shell.ts`
**Status**: Not started
**Why**: Shell process utilities for terminal
**Current**: Creates WebContainer shell processes
**Needs**:
- Remove `newShellProcess()` and `newBoltShellProcess()` - no longer needed
- Terminal now uses WebSocket directly (already implemented in TerminalStore)
- May be able to delete entire file

**Note**: TerminalStore already updated to use WebSocket, so this may just need cleanup.

#### 5. `app/components/workbench/Search.tsx`
**Status**: Not started
**Why**: File search functionality
**Current**: May use WebContainer fs to search files
**Needs**:
- Review if it accesses WebContainer
- Update to use dockerRuntime.readdir() and dockerRuntime.readFile()
- Add sessionId from context/props

### LOW PRIORITY - Legacy Files to Remove

#### 6. `app/lib/webcontainer/index.ts`
**Status**: Can be deleted
**Why**: Old WebContainer initialization
**Action**: Delete file and remove any imports

#### 7. `app/lib/webcontainer/auth.client.ts`
**Status**: Can be deleted
**Why**: WebContainer authentication
**Action**: Delete file and remove any imports

#### 8. `app/routes/webcontainer.connect.$id.tsx`
**Status**: Can be deleted
**Why**: WebContainer connection route
**Action**: Delete file and update routing if needed

#### 9. Remove `@webcontainer/api` import from `app/lib/stores/files.ts`
**Status**: Partially complete
**Current**: Still has `import type { PathWatcherEvent } from '@webcontainer/api'`
**Action**: Remove import, PathWatcherEvent no longer used

## Testing Requirements

### Unit Tests
- [ ] Docker runtime client methods
- [ ] Backend API endpoints
- [ ] Store methods with mocked Docker runtime

### Integration Tests
- [ ] Session creation and lifecycle
- [ ] File operations (create, read, update, delete)
- [ ] Terminal WebSocket communication
- [ ] Preview server detection and proxy
- [ ] Command execution
- [ ] Multi-session handling

### E2E Tests
- [ ] Complete AI workflow (prompt → code generation → execution)
- [ ] Git operations
- [ ] Preview server deployment
- [ ] Terminal commands
- [ ] File tree operations

## Known Issues to Address

### 1. File Watching
**Issue**: Currently uses polling (2s interval) instead of real-time
**Impact**: 2-second delay before file changes appear
**Potential Solution**:
- Use Docker volume watching
- Implement WebSocket-based file notifications from backend
- Or keep polling but reduce interval to 500ms

### 2. Preview URL Format
**Issue**: Preview URLs are `localhost:4000/preview/{sessionId}/{port}`
**Impact**: Not shareable outside localhost
**Potential Solution**:
- Add ngrok integration
- Support custom domain configuration
- Document limitation

### 3. Session Persistence
**Issue**: Sessions are lost on page refresh
**Impact**: User has to wait for container restart
**Potential Solution**:
- Store sessionId in localStorage
- Backend checks if session still exists
- Reconnect to existing session if available

### 4. Container Startup Time
**Issue**: 2-5 seconds to create container
**Impact**: Slight delay before user can start working
**Potential Solution**:
- Pre-warm containers
- Show loading state with progress
- Keep containers warm in pool

## Implementation Priority

### Phase 1 (Critical - Blocking basic functionality)
1. Update Workbench component to create sessions
2. Update ActionRunner to use Docker runtime
3. Test basic AI code generation workflow

### Phase 2 (Important - Core features)
1. Update Git hook for version control features
2. Update/remove shell utilities
3. Test git operations

### Phase 3 (Polish)
1. Remove legacy WebContainer files
2. Clean up unused imports
3. Improve file watching (reduce polling interval or use events)
4. Add session persistence

### Phase 4 (Optional enhancements)
1. Pre-warm container pool
2. Better error messages
3. Session management UI
4. Container resource monitoring

## How to Contribute

If you want to help complete this migration:

1. **Pick a file** from the HIGH PRIORITY section
2. **Follow the pattern** established in the completed stores:
   - Replace `webcontainer` with `dockerRuntime`
   - Add `sessionId` parameter
   - Use async/await for API calls
   - Handle errors appropriately
3. **Test your changes** manually:
   - Start Docker
   - Run `pnpm run dev`
   - Test the specific feature you updated
4. **Update this document** when done

## Questions or Issues?

- Review `MIGRATION.md` for architecture details
- Check `planning.md` and `research.md` for original specs
- Ask in the community: https://thinktank.ottomator.ai

## Progress Tracking

Last updated: 2025-10-12

- **Backend**: 100% complete ✅
- **Core Stores**: 100% complete ✅
- **Documentation**: 100% complete ✅
- **Action Runner**: 0% complete ❌
- **Git Hook**: 0% complete ❌
- **Workbench Init**: 0% complete ❌
- **Shell Utils**: 0% complete ❌
- **Testing**: 0% complete ❌

**Overall Completion**: ~60%
