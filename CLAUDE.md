# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HiTESS WorkBench** is a structural engineering analysis platform for internal use. It wraps legacy native analysis executables (`.exe`) with a modern web UI and adds an AI assistant. The system runs as an Electron desktop app (distributed as a portable `.exe`) that connects to a shared team server.

## Development Commands

### Backend (FastAPI)

```bash
# Activate virtual environment (Windows)
HiTessWorkBenchBackEnd/WorkBenchEnv/Scripts/activate

# Run dev server (from HiTessWorkBenchBackEnd/)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Install dependencies
pip install -r requirements.txt
```

### Frontend (React + Vite)

```bash
# Dev server only (from HiTessWorkBench/frontend/)
npm run dev

# Build frontend for Electron packaging
npm run build
```

### Electron Desktop App

```bash
# Run full dev environment (React dev server + Electron) (from HiTessWorkBench/)
npm run dev

# Build distributable portable .exe
npm run dist
```

> `npm run dev` from `HiTessWorkBench/` uses `concurrently` to start both the React dev server (port 5173) and Electron simultaneously.

## Architecture

The project has three layers:

```
[Electron shell]  →  loads localhost:5173 (dev) or frontend/dist/index.html (prod)
[React SPA]       →  communicates via REST to backend server
[FastAPI backend] →  runs analysis jobs, serves DB data, handles AI queries
```

### Key Configuration Points

- **Backend URL**: `HiTessWorkBench/frontend/src/config.js` — change `API_BASE_URL` to point at the server IP. Currently `http://10.133.122.70:8000`.
- **Database**: MySQL at `localhost:3306/hitessworkbench`, credentials in `HiTessWorkBenchBackEnd/app/database.py`. Tables are auto-created on server startup via SQLAlchemy.
- **Electron mode detection**: `electron/index.js` checks `app.isPackaged` — dev loads `localhost:5173`, production loads `frontend/dist/index.html`.

### Analysis Job Flow

1. Frontend uploads files → `POST /api/analysis/{type}/request`
2. Backend saves files to `userConnection/{timestamp}_{employee_id}_{program}/`
3. Job submitted to `ThreadPoolExecutor` (max 5 concurrent) in `app/services/job_manager.py`
4. Service file (`truss_service.py`, `assessment_service.py`, `beam_service.py`) executes the corresponding `.exe` in `InHouseProgram/`
5. Frontend polls `GET /api/analysis/status/{job_id}` until complete (0–100%)
6. Results stored in DB (`result_info` JSON column = file paths), downloadable via `GET /api/download?filepath=...`

Job state is stored in memory (`job_status_store` dict). A server restart loses all in-flight job status — this is a known limitation noted in the code (Redis recommended for production).

### AI Pipeline

- Triggered by admin via `POST /api/ai/ingest` → `app/AI/ingest.py` chunks documents, builds FAISS index + BM25 pickle
- Chat via `POST /api/ai/chat` → `app/AI/chain.py` runs multi-query reformulation → hybrid search (30% BM25 + 70% vector) → Ollama LLM (`qwen2.5:7b` at `localhost:11434`)
- Embeddings: BGE-M3 multilingual model

### Authentication

- Login is employee_id only (no password). Users are inactive by default until an admin approves them.
- User session stored in `localStorage` on the frontend and passed via props/context — there is no JWT or session token.

### Router Structure (Backend)

| File | Prefix | Responsibility |
|------|--------|----------------|
| `routers/auth.py` | `/api` | Login, Register |
| `routers/users.py` | `/api/users` | User CRUD, approval |
| `routers/analysis.py` | `/api/analysis` | Job submission, status, history, download |
| `routers/support.py` | `/api` | Notices, user guides, feature requests |
| `routers/system.py` | `/api/system` | CPU/memory/DB health, queue status |
| `routers/ai.py` | `/api/ai` | Chat, ingest, document list |

### Frontend Page Structure (React)

Pages live in `HiTessWorkBench/frontend/src/pages/` and are routed from `App.jsx` via a `currentPage` state (not React Router). Navigation is sidebar-driven.

Key pages:
- `analysis/NewAnalysis.jsx` — program selection entry point
- `analysis/TrussAnalysis.jsx` — Truss Model Builder form + 3D viewer
- `analysis/TrussAssessment.jsx` — BDF upload + assessment
- `analysis/ComponentWizard.jsx` — interactive component-based analysis
- `dashboard/Dashboard.jsx` — main landing with stats
- `Administration/` — user management, system monitoring (admin only)
- `AI/` — AI Lab Assistant and Hi-Lab Insight pages
