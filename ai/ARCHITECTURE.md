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
