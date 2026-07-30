# AI Context Bundle
Generated: Sat May 23 13:59:49 PDT 2026

## ⚠️ Agent Navigation Guide
1. Start with the **Current State** below to understand the focus.
2. Check **Active Tasks** for your specific assignment.
3. Only read files from the repository structure that are directly related to those tasks.
4. Do NOT perform full repository scans unless the task is an architectural audit.

## 1. Authoritative Rules (AGENTS.md)
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

## 2. Architecture (ARCHITECTURE.md)
# Architecture

PURPOSE: Technical system design and data flow of the AIA2ndBrain application.

## Overview
AIA2ndBrain is a CLI-based automation tool that monitors a specific iCloud directory for new notes and uses Gemini AI to categorize and summarize them into a PARA (Projects, Areas, Resources, Archives) structure.

## System Components

### 1. File Watcher (Chokidar)
Monitors the `Inbox/notes` directory for new `.txt`, `.md`, or `.pdf` files.

### 2. Classification Engine (Gemini)
Uses `@google/generative-ai` to send note content to Gemini Pro. It requests a structured JSON response containing:
- Area (PARA category)
- Domain
- Type
- Title
- Tags
- Summary

### 3. PDF Processor (Poppler)
Uses `pdftotext` from the Poppler suite to extract text from PDF files before sending it to the Classification Engine.

### 4. Storage (iCloud Drive / PARA)
Organizes notes into a directory structure based on the AI-determined `area` and `title`. Each note is stored as an `index.md` file with YAML frontmatter, alongside the original asset.

## Data Flow
1. **Input**: User drops a file into `Inbox/notes`.
2. **Detection**: Chokidar triggers an `add` event.
3. **Extraction**: If PDF, extract text; otherwise, read file content.
4. **Classification**: Send content to Gemini with a structured prompt.
5. **Organization**: Create a slugified folder in the target PARA area, write `index.md` with metadata, and move the original file as an asset.

## AI Workspace Substrate
This repository uses an AI-assisted engineering substrate located in `/ai` to maintain context across sessions.

- **Cognition Layer**: State and tasks are tracked in `PROJECT_STATE.md`.
- **Rules**: Agent constraints are defined in `AGENTS.md`.
- **Flow**: Human Pilot -> AI Implementation -> Verification via `npm start`.

## 3. Project State (PROJECT_STATE.md)
# Project State

## Current Focus
- Core automation: TXT/MD/PDF classification and PARA organization.

## Active Tasks
- [ ] Improve PDF extraction robustness (currently relies on `pdftotext`).
- [ ] Refine Gemini classification prompt for better accuracy.
- [ ] Verify model availability (using `src/listModels.js`).

## Backlog
- [ ] Voice memo transcription (audio -> text -> PARA).
- [ ] Weekly Digest: Surfaced insights and action items.
- [ ] Obsidian backlink support.
- [ ] Dashboard (React/Next.js UI).
- [ ] Local vector search (embeddings).

## Completed
- [x] Basic file watcher with Chokidar.
- [x] Gemini AI integration for classification.
- [x] PARA directory structure auto-healing.
- [x] Basic PDF text extraction using Poppler.

## 4. Repository Structure
```text
.
./node_modules
./node_modules/pathhash
./node_modules/path-is-absolute
./node_modules/temp
./node_modules/walk
./node_modules/dotenv
./node_modules/rimraf
./node_modules/balanced-match
./node_modules/pdf-extract
./node_modules/once
./node_modules/inherits
./node_modules/async
./node_modules/chokidar
./node_modules/eyespect
./node_modules/readdirp
./node_modules/brace-expansion
./node_modules/@napi-rs
./node_modules/minimatch
./node_modules/fs.realpath
./node_modules/forEachAsync
./node_modules/concat-map
./node_modules/yaml
./node_modules/@google
./node_modules/glob
./node_modules/sequence
./node_modules/wrappy
./node_modules/graceful-fs
./node_modules/inflight
./README.md
./Notes
./Notes/Failed Exports
./Notes/iCloud
./package-lock.json
./package.json
./ai
./ai/ai-context.sh
./ai/ARCHITECTURE.md
./ai/CONTEXT_BUNDLE.md
./ai/PROJECT_STATE.md
./ai/AGENTS.md
./src
./src/main.js
./src/listModels.js
```

## 5. Recent Git Changes (Summary)
```text
141d4b9 update pdf extraction
6f40947 add simple note summary and categorizing
0fa1588 chores
fea99c2 Update README.md
86f02ef Initial commit
```

## 6. Active Diff
```diff
diff --git a/.gitignore b/.gitignore
index 3ec544c..966ffe1 100644
--- a/.gitignore
+++ b/.gitignore
@@ -1,2 +1,3 @@
 node_modules/
-.env
\ No newline at end of file
+.env
+Notes
\ No newline at end of file
```
