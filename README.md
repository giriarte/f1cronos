# F1 Cronos

A Formula 1 data viewer for exploring race schedules, session results, and telemetry across the 2020–2026 seasons. Supports real-time live timing during active F1 sessions.

![F1 Cronos](https://img.shields.io/badge/F1-Data%20Viewer-red?style=flat-square) ![React](https://img.shields.io/badge/React-18-blue?style=flat-square) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?style=flat-square)

## Overview

F1 Cronos lets you:

- Browse the full race calendar for any season from 2020 to 2026
- View circuit maps, locations, and round numbers for every Grand Prix
- Inspect session results (Practice, Qualifying, Sprint, Race) with driver positions, lap times, and points
- Stream live F1 timing data via WebSocket when a session is in progress
- Explore detailed per-lap telemetry: speed, throttle, brake, gear, RPM, and DRS

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, React Router v6, Vite 5 |
| Backend | Python 3.11, FastAPI, Uvicorn |
| F1 Data | FastF1 3.5 (official F1 API + live timing) |
| Data Processing | Pandas |
| Live Timing | WebSockets |
| Containerization | Docker |

## Project Structure

```
f1cronos/
├── backend/
│   ├── main.py           # FastAPI app — all REST and WebSocket endpoints
│   ├── requirements.txt  # Python dependencies
│   └── Dockerfile
├── src/
│   ├── api/              # Fetch wrappers for the backend
│   ├── components/       # RaceCard, Sidebar
│   ├── pages/            # HomePage, RaceDetailPage
│   ├── data/             # Static season schedules (2020–2026)
│   └── utils/            # Schedule mapper utilities
├── .env.local            # Frontend env vars (VITE_API_URL)
├── package.json
└── vite.config.js
```

## Running Locally

You need **Node.js 18+** and **Python 3.11+**.

### 1. Start the backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

The API starts at `http://localhost:8000`. FastF1 caches data in `backend/cache/` after the first fetch.

### 2. Start the frontend

```bash
# from the project root
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` and proxies API calls to port 8000 via the `VITE_API_URL` set in `.env.local`.

### 3. Open the app

Navigate to [http://localhost:5173](http://localhost:5173).

---

### Docker (backend only)

```bash
docker build -t f1cronos ./backend
docker run -p 8000:8000 f1cronos
```

Then run the frontend with `npm run dev` as above.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend base URL used by the React app |

Set in `.env.local` at the project root.

## Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/schedule/{year}` | Full race calendar for a season |
| `GET` | `/sessions/{year}/{round}` | Available sessions for a race weekend |
| `GET` | `/results/{year}/{round}/{session}` | Session results |
| `GET` | `/laps/{year}/{round}/{session}/{driver}` | Lap-by-lap data for a driver |
| `GET` | `/telemetry/{year}/{round}/{session}/{driver}/{lap}` | Full telemetry for a single lap |
| `WS` | `/ws/live` | WebSocket stream for live F1 timing |
