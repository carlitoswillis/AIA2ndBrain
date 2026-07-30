# Agent Guidelines (AGENTS.md)

PURPOSE: This is the authoritative rulebook for AI assistants. It defines the 'how' and 'what' of the codebase.

## Project Context
- **Objective**: Local, iCloud-Synced AI-Augmented Second Brain System. Automatically organizes notes into PARA structure using Gemini.
- **Stack**: Node.js (ESM), @google/generative-ai, chokidar (watcher), yaml (frontmatter), Poppler (pdftotext).

## Architecture Constraints
- **Trigger**: File system watcher on `Inbox/notes`.
- **Classification**: Gemini Pro (via `@google/generative-ai`) returns JSON for routing.
- **Persistence**: PARA structure (Projects, Areas, Resources, Archives) in iCloud Drive.
- **Markdown Persistence**: All project state/backlog must be tracked in `/ai`.

## Coding Conventions
- **Explicit over Implicit**: Avoid hidden logic, reflection, or complex inheritance.
- **Verification First**: All changes must be verified via the project's own startup scripts (`npm start`).
- **Compact Context**: Keep context files task-scoped and minimal.

## How to Navigate This Workspace (Priority Flow)
To minimize token waste and maximize focus, follow this priority sequence:
1. **START HERE**: Read `PROJECT_STATE.md`. It defines the current high-level objective and active tasks.
2. **Operational Rules**: Read `AGENTS.md` (this file). Adhere strictly to these constraints.
3. **Architecture**: Read `ARCHITECTURE.md` for system design details.
4. **Self-Correction**: If you feel your understanding of the project state is out of sync, you may run `./ai/ai-context.sh` to refresh your local context bundle.
