import asyncio
import json
import threading
from contextlib import asynccontextmanager
from typing import Optional

import fastf1
import pandas as pd
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

fastf1.Cache.enable_cache("cache")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="F1 Cronos API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict to your frontend URL in production
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_blocking(func, *args, **kwargs):
    """Run a blocking FastF1 call in a thread pool so FastAPI stays responsive."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, lambda: func(*args, **kwargs))


def load_session(year: int, round_number: int, session_type: str) -> fastf1.core.Session:
    session = fastf1.get_session(year, round_number, session_type)
    session.load(telemetry=True, weather=False, messages=False)
    return session


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "ok", "service": "F1 Cronos API"}


# ---------------------------------------------------------------------------
# Historical – Schedule
# ---------------------------------------------------------------------------

@app.get("/schedule/{year}")
async def get_schedule(year: int):
    """Return the full event schedule for a given season."""
    schedule = await run_blocking(fastf1.get_event_schedule, year, include_testing=False)
    cols = ["RoundNumber", "Country", "Location", "EventName", "OfficialEventName", "EventDate", "EventFormat"]
    return schedule[cols].to_dict(orient="records")


# ---------------------------------------------------------------------------
# Historical – Laps
# ---------------------------------------------------------------------------

@app.get("/laps/{year}/{round_number}/{session_type}/{driver}")
async def get_driver_laps(year: int, round_number: int, session_type: str, driver: str):
    """
    Return all laps for a driver in a session.
    session_type: 'Q' for qualifying, 'R' for race, 'FP1' / 'FP2' / 'FP3'
    driver: three-letter code e.g. 'VER', 'HAM'
    """
    try:
        session = await run_blocking(load_session, year, round_number, session_type)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    laps = session.laps.pick_drivers(driver)
    if laps.empty:
        raise HTTPException(status_code=404, detail=f"Driver {driver} not found in session")

    cols = ["LapNumber", "LapTime", "Sector1Time", "Sector2Time", "Sector3Time",
            "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST", "Compound", "IsPersonalBest"]
    result = laps[cols].copy()
    # Convert timedeltas to seconds for JSON serialisation
    for col in ["LapTime", "Sector1Time", "Sector2Time", "Sector3Time"]:
        result[col] = result[col].dt.total_seconds()
    return result.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Historical – Telemetry for a single lap
# ---------------------------------------------------------------------------

@app.get("/telemetry/{year}/{round_number}/{session_type}/{driver}/{lap_number}")
async def get_lap_telemetry(
    year: int,
    round_number: int,
    session_type: str,
    driver: str,
    lap_number: int,
):
    """
    Return car telemetry (speed, throttle, brake, gear, RPM, DRS) for one lap.
    """
    try:
        session = await run_blocking(load_session, year, round_number, session_type)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    laps = session.laps.pick_drivers(driver)
    lap = laps[laps["LapNumber"] == lap_number]
    if lap.empty:
        raise HTTPException(status_code=404, detail=f"Lap {lap_number} not found for {driver}")

    telemetry = lap.iloc[0].get_telemetry()
    cols = ["Time", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS", "Distance"]
    result = telemetry[cols].copy()
    result["Time"] = result["Time"].dt.total_seconds()
    return result.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Historical – Available sessions for a round
# ---------------------------------------------------------------------------

@app.get("/sessions/{year}/{round_number}")
async def get_available_sessions(year: int, round_number: int):
    """Return the ordered list of sessions for a round (e.g. Practice 1, Qualifying, Race)."""
    def _load():
        return fastf1.get_event(year, round_number)

    try:
        event = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    sessions = []
    for i in range(1, 6):
        name = event.get(f"Session{i}")
        if name and str(name) not in ("", "None", "nan"):
            sessions.append({"index": i, "name": str(name)})
    return sessions


# ---------------------------------------------------------------------------
# Historical – Session results
# ---------------------------------------------------------------------------

def _td_to_laptime(td) -> str | None:
    """Convert a pandas Timedelta to a m:ss.mmm string, or None if NaT."""
    if pd.isna(td):
        return None
    total = td.total_seconds()
    mins = int(total // 60)
    secs = total % 60
    return f"{mins}:{secs:06.3f}" if mins > 0 else f"{secs:.3f}"


@app.get("/results/{year}/{round_number}/{session_name}")
async def get_session_results(year: int, round_number: int, session_name: str):
    """
    Return finishing results for any session type.
    session_name must match exactly what /sessions returns (e.g. 'Race', 'Qualifying', 'Practice 1').
    """
    def _load():
        s = fastf1.get_session(year, round_number, session_name)
        s.load(telemetry=False, weather=False, messages=False)
        return s

    try:
        session = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    if session.results is None or session.results.empty:
        return []

    rows = []
    for _, r in session.results.iterrows():
        rows.append({
            "position":          int(r["Position"]) if pd.notna(r.get("Position")) else None,
            "classifiedPosition": str(r.get("ClassifiedPosition", "")),
            "driverNumber":      str(r.get("DriverNumber", "")),
            "abbreviation":      str(r.get("Abbreviation", "")),
            "fullName":          str(r.get("FullName", "")),
            "teamName":          str(r.get("TeamName", "")),
            "teamColor":         f"#{r.get('TeamColor', 'ffffff')}",
            "gridPosition":      int(r["GridPosition"]) if pd.notna(r.get("GridPosition")) else None,
            "q1":    _td_to_laptime(r.get("Q1")),
            "q2":    _td_to_laptime(r.get("Q2")),
            "q3":    _td_to_laptime(r.get("Q3")),
            "time":  _td_to_laptime(r.get("Time")),
            "status": str(r.get("Status", "")),
            "points": float(r["Points"]) if pd.notna(r.get("Points")) else 0,
        })
    return rows


# ---------------------------------------------------------------------------
# Historical – Driver list for a session
# ---------------------------------------------------------------------------

@app.get("/drivers/{year}/{round_number}/{session_type}")
async def get_drivers(year: int, round_number: int, session_type: str):
    """Return the list of drivers that participated in a session."""
    try:
        session = await run_blocking(load_session, year, round_number, session_type)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    drivers = session.drivers
    results = []
    for abbr in drivers:
        info = session.get_driver(abbr)
        results.append({
            "abbreviation": abbr,
            "full_name": info.get("FullName", ""),
            "team": info.get("TeamName", ""),
            "number": info.get("DriverNumber", ""),
        })
    return results


# ---------------------------------------------------------------------------
# Live – WebSocket
# ---------------------------------------------------------------------------
#
# FastF1's SignalRClient connects to livetiming.formula1.com during an active
# session. Data arrives ~5 seconds after the real event (F1 broadcast delay).
#
# The WebSocket below:
#   1. Accepts a browser connection
#   2. Spins up a background thread running the FastF1 live client
#   3. Bridges incoming messages into an asyncio Queue
#   4. Streams Queue items to the browser as JSON
#
# NOTE: The live client only receives data while an F1 session is running.
#       Outside of sessions it will connect but sit idle.
# ---------------------------------------------------------------------------

class _LiveBridge:
    """Bridges FastF1's threaded SignalR client to asyncio."""

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()

    def on_message(self, msg_type: str, msg, timestamp):
        payload = json.dumps({"type": msg_type, "data": msg, "ts": str(timestamp)})
        self._loop.call_soon_threadsafe(self._queue.put_nowait, payload)

    def run(self):
        from fastf1.livetiming.client import SignalRClient  # import here — heavy dep

        client = SignalRClient(filename=None, callback=self.on_message)
        try:
            client.start()
        except Exception as exc:
            error = json.dumps({"type": "error", "detail": str(exc)})
            self._loop.call_soon_threadsafe(self._queue.put_nowait, error)

    def stop(self):
        self._stop.set()


@app.websocket("/ws/live")
async def live_timing(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    bridge = _LiveBridge(loop, queue)
    thread = threading.Thread(target=bridge.run, daemon=True)
    thread.start()

    try:
        while True:
            message = await asyncio.wait_for(queue.get(), timeout=30)
            await websocket.send_text(message)
    except asyncio.TimeoutError:
        await websocket.send_text(json.dumps({"type": "heartbeat"}))
    except WebSocketDisconnect:
        pass
    finally:
        bridge.stop()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
