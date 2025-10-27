# AIA2ndBrain (AI-Augmented Second Brain)

A fully reactive, local-first Second Brain system that automatically captures, understands, and organizes your thoughts — powered by Gemini. When new notes arrive, the system extracts content, classifies them using the PARA framework (Projects, Areas, Resources, Archives), and generates clean Markdown knowledge files for long-term organization and insight.

This project focuses on **zero manual overhead**: save a note → get structured knowledge.

---

## ✨ Core Features (MVP)

| Feature | Status |
|--------|:-----:|
| Local PARA vault auto-creation | ✅ |
| Watch Apple Notes PDF exports | ✅ |
| Extract text + summarize notes | ✅ |
| Classify captures via Gemini | ✅ |
| Create organized Markdown notes | ✅ |

Future extensions include:
- Audio pipeline (voice memo → transcription → classification)
- Weekly digest (new insights, unfinished tasks, emerging themes)
- To-do suggestions based on captured tasks
- Knowledge graph + resurfacing engine

---

## 🗂 PARA Vault Structure

The app ensures this structure exists at runtime:

~/SecondBrain/
Inbox/
notes/
audio/
images/
Projects/
Areas/
Resources/
Archives/
Reviews/

All output Markdown notes use YAML front-matter with metadata:
```yaml
---
captured_at: 2025-10-27T00:00:00Z
area: "Projects"
domain: "Music"
type: "idea"
tags: ["chorus","melody"]
source: "Inbox/notes/my_note.pdf"
---


⸻

🧱 Architecture

Apple Notes → Inbox/notes → Docker → Node service → Gemini AI →
Markdown note → PARA vault → Weekly insights (later)

Local-first: All data lives in your personal PARA vault.
Gemini is used only for classification + summarization.

⸻

🚀 Quick Start

Prereqs
	•	macOS
	•	Docker Desktop
	•	Node 20+
	•	Gemini API key

Setup

git clone https://github.com/YOURNAME/aia2ndbrain
cd aia2ndbrain

cp .env.example .env
# add your GEMINI_API_KEY inside .env

docker compose up --build

Then simply export an Apple Note as PDF to:

~/SecondBrain/Inbox/notes

✅ A new Markdown note appears inside your PARA vault.

⸻

📌 Roadmap
	•	Audio capture (voice memos)
	•	Screenshot OCR
	•	Weekly digest + calendar review
	•	Smart resurfacing engine
	•	Knowledge graph navigation

Progress is tracked on Trello: (attach board link here)

⸻

🔐 Privacy First

All raw data stays local inside the ~/SecondBrain folder.
Only text needed for classification/summarization is sent to Gemini.
Optional future: fully local LLM mode.

⸻

🤝 Contributing

This project is designed to evolve into a powerful personal knowledge engine.
Suggestions, issues, and improvements are welcome.

⸻

🧑‍💻 Author

Created by Carlitos Willis (Based on Tiago Forte's Building a Second Brain) ― exploring how AI can enhance personal knowledge, creativity, and consistency.

⸻

📜 License

MIT (modifiable based on future needs)
