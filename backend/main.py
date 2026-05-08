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


def _resolve_round(schedule: pd.DataFrame, round_number: int, event_date: Optional[str]) -> int:
    """
    Return the FastF1 round number that best matches event_date.
    Finds the schedule row whose EventDate is within 10 days of event_date.
    Falls back to round_number when no date is given or no close match exists.
    This compensates for round renumbering when races are cancelled mid-season.
    """
    if not event_date:
        return round_number
    try:
        target = pd.Timestamp(event_date).normalize()
        dates = schedule["EventDate"].copy()
        if hasattr(dates.dt, "tz") and dates.dt.tz is not None:
            dates = dates.dt.tz_localize(None)
        dates = dates.dt.normalize()
        diffs = (dates - target).abs()
        idx = diffs.idxmin()
        if diffs[idx] <= pd.Timedelta("10 days"):
            return int(schedule.loc[idx, "RoundNumber"])
    except Exception:
        pass
    return round_number


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

    try:
        laps = session.laps.pick_drivers([driver])
        if laps.empty:
            raise HTTPException(status_code=404, detail=f"Driver {driver} not found in session")

        desired_cols = [
            "LapNumber", "LapTime", "Sector1Time", "Sector2Time", "Sector3Time",
            "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST", "Compound", "IsPersonalBest",
        ]
        available_cols = [c for c in desired_cols if c in laps.columns]
        result = laps[available_cols].copy()

        timedelta_cols = ["LapTime", "Sector1Time", "Sector2Time", "Sector3Time"]
        for col in timedelta_cols:
            if col in result.columns:
                try:
                    result[col] = result[col].dt.total_seconds()
                except Exception:
                    result[col] = None

        # float('nan') is not valid JSON — convert to None at Python dict level
        import math
        records = result.to_dict(orient="records")
        def _clean(v):
            if isinstance(v, float) and math.isnan(v):
                return None
            return v
        return [{k: _clean(v) for k, v in row.items()} for row in records]

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


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
async def get_available_sessions(year: int, round_number: int, event_date: Optional[str] = None):
    """Return the ordered list of sessions for a round (e.g. Practice 1, Qualifying, Race)."""
    def _load():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        real_round = _resolve_round(schedule, round_number, event_date)
        return fastf1.get_event(year, real_round)

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


def _build_results_from_session(session) -> list:
    """Build result rows from session.results (race / qualifying / sprint)."""
    rows = []
    for _, r in session.results.iterrows():
        rows.append({
            "position":           int(r["Position"]) if pd.notna(r.get("Position")) else None,
            "classifiedPosition": str(r.get("ClassifiedPosition", "")),
            "driverNumber":       str(r.get("DriverNumber", "")),
            "abbreviation":       str(r.get("Abbreviation", "")),
            "fullName":           str(r.get("FullName", "")),
            "teamName":           str(r.get("TeamName", "")),
            "teamColor":          f"#{r.get('TeamColor', 'ffffff')}",
            "gridPosition":       int(r["GridPosition"]) if pd.notna(r.get("GridPosition")) else None,
            "q1":    _td_to_laptime(r.get("Q1")),
            "q2":    _td_to_laptime(r.get("Q2")),
            "q3":    _td_to_laptime(r.get("Q3")),
            "time":  _td_to_laptime(r.get("Time")),
            "status": str(r.get("Status", "")),
            "points": float(r["Points"]) if pd.notna(r.get("Points")) else 0,
        })
    return rows


def _build_results_from_laps(session) -> list:
    """Derive practice results from fastest valid lap per driver."""
    laps = session.laps
    if laps is None or laps.empty:
        return []

    valid = laps[laps["LapTime"].notna()]
    if valid.empty:
        return []

    fastest = (
        valid.groupby("Driver")["LapTime"]
        .min()
        .reset_index()
        .rename(columns={"Driver": "Abbreviation", "LapTime": "BestLap"})
        .sort_values("BestLap")
        .reset_index(drop=True)
    )

    p1_time = fastest.iloc[0]["BestLap"]
    rows = []
    for pos, row in fastest.iterrows():
        abbr = row["Abbreviation"]
        try:
            info = session.get_driver(abbr)
        except Exception:
            info = {}
        gap = row["BestLap"] - p1_time
        gap_str = f"+{gap.total_seconds():.3f}s" if pos > 0 else None
        rows.append({
            "position":           pos + 1,
            "classifiedPosition": str(pos + 1),
            "driverNumber":       str(info.get("DriverNumber", "")),
            "abbreviation":       abbr,
            "fullName":           str(info.get("FullName", "")),
            "teamName":           str(info.get("TeamName", "")),
            "teamColor":          f"#{info.get('TeamColor', 'ffffff')}",
            "gridPosition":       None,
            "q1":                 None,
            "q2":                 None,
            "q3":                 None,
            "time":               _td_to_laptime(row["BestLap"]) if pos == 0 else gap_str,
            "status":             "",
            "points":             0,
        })
    return rows


@app.get("/results/{year}/{round_number}/{session_name}")
async def get_session_results(year: int, round_number: int, session_name: str, event_date: Optional[str] = None):
    """
    Return finishing results for any session type.
    session_name must match exactly what /sessions returns (e.g. 'Race', 'Qualifying', 'Practice 1').
    Practice sessions are derived from fastest lap per driver since they have no formal results.
    """
    def _load():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        real_round = _resolve_round(schedule, round_number, event_date)
        s = fastf1.get_session(year, real_round, session_name)
        n = session_name.lower()
        # Sprint qualifying/shootout results are derived from timing data and require
        # race control messages to account for deleted lap times.
        needs_messages = ("sprint" in n and "qualifying" in n) or "shootout" in n
        s.load(telemetry=False, weather=False, messages=needs_messages)
        return s

    try:
        session = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Practice sessions have results populated but Time is always NaT; use laps instead.
    is_practice = "practice" in session_name.lower()
    if not is_practice and session.results is not None and not session.results.empty:
        return _build_results_from_session(session)

    return _build_results_from_laps(session)


# ---------------------------------------------------------------------------
# Historical – Qualifying sector telemetry
# ---------------------------------------------------------------------------

def _assign_sector_colors(times: dict) -> dict:
    """Rank sector times: purple=1st, green=top 30%, yellow=mid 35%, red=bottom 35%."""
    if not times:
        return {}
    ranked = sorted(times, key=times.get)
    n = len(ranked)
    out = {}
    for i, abbr in enumerate(ranked):
        if i == 0:
            out[abbr] = "purple"
        elif i < max(1, round(n * 0.30)):
            out[abbr] = "green"
        elif i < max(1, round(n * 0.65)):
            out[abbr] = "yellow"
        else:
            out[abbr] = "red"
    return out


@app.get("/quali-sectors/{year}/{round_number}/{session_name}")
async def get_quali_sectors(year: int, round_number: int, session_name: str, event_date: Optional[str] = None):
    """
    Return per-sector timing and color rankings for a qualifying session.
    For each driver returns S1/S2/S3 times (seconds) and purple/green/yellow/red
    color for each sector in Q1, Q2, Q3 segments.
    """
    def _load():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        real_round = _resolve_round(schedule, round_number, event_date)
        s = fastf1.get_session(year, real_round, session_name)
        s.load(laps=True, telemetry=False, weather=False, messages=False)
        return s

    try:
        session = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    if session.results is None or session.results.empty:
        return []

    results = session.results
    laps = session.laps

    def get_sector_times(abbr: str, q_time):
        if pd.isna(q_time):
            return None
        driver_laps = laps[laps["Driver"] == abbr]
        if driver_laps.empty:
            return None
        diff = (driver_laps["LapTime"] - q_time).abs()
        best_idx = diff.idxmin()
        if diff[best_idx] > pd.Timedelta("1s"):
            return None
        lap = driver_laps.loc[best_idx]
        def td(col):
            v = lap[col]
            return v.total_seconds() if not pd.isna(v) else None
        return {"s1": td("Sector1Time"), "s2": td("Sector2Time"), "s3": td("Sector3Time")}

    # Collect raw sector data per driver per Q segment
    raw: dict = {}
    for _, row in results.iterrows():
        abbr = str(row["Abbreviation"])
        raw[abbr] = {
            "q1": get_sector_times(abbr, row.get("Q1")),
            "q2": get_sector_times(abbr, row.get("Q2")),
            "q3": get_sector_times(abbr, row.get("Q3")),
        }

    # Compute colors per Q segment × sector
    color_maps: dict = {}
    for q in ("q1", "q2", "q3"):
        color_maps[q] = {}
        for s in ("s1", "s2", "s3"):
            times = {
                abbr: data[q][s]
                for abbr, data in raw.items()
                if data.get(q) and data[q].get(s) is not None
            }
            color_maps[q][s] = _assign_sector_colors(times)

    # Assemble response in results order
    output = []
    for _, row in results.iterrows():
        abbr = str(row["Abbreviation"])
        entry = {"abbreviation": abbr}
        for q in ("q1", "q2", "q3"):
            seg = raw.get(abbr, {}).get(q)
            if seg is None:
                entry[q] = None
            else:
                entry[q] = {
                    "s1": seg.get("s1"),
                    "s2": seg.get("s2"),
                    "s3": seg.get("s3"),
                    "s1Color": color_maps[q]["s1"].get(abbr),
                    "s2Color": color_maps[q]["s2"].get(abbr),
                    "s3Color": color_maps[q]["s3"].get(abbr),
                }
        output.append(entry)

    return output


# ---------------------------------------------------------------------------
# Historical – Driver Championship Standings up to a round
# ---------------------------------------------------------------------------

@app.get("/standings/{year}/{round_number}")
async def get_driver_standings(year: int, round_number: int, event_date: Optional[str] = None):
    """
    Return driver championship standings after the given round.
    Aggregates points from Race and Sprint sessions.
    When event_date is provided it is used as the cutoff (resilient to round-number
    renumbering that happens when races are cancelled).
    """
    def _compute():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        if event_date:
            cutoff = pd.Timestamp(event_date)
            completed = schedule[schedule["EventDate"] <= cutoff]
        else:
            completed = schedule[schedule["RoundNumber"] <= round_number]

        points_map: dict = {}

        for _, event in completed.iterrows():
            rn = int(event["RoundNumber"])
            for i in range(1, 6):
                name = event.get(f"Session{i}", "")
                if not name or str(name) in ("", "None", "nan"):
                    continue
                n = str(name).strip().lower()
                if n not in ("race", "sprint"):
                    continue
                try:
                    s = fastf1.get_session(year, rn, str(name))
                    s.load(telemetry=False, weather=False, messages=False, laps=False)
                    if s.results is None or s.results.empty:
                        continue
                    for _, r in s.results.iterrows():
                        abbr = str(r.get("Abbreviation", ""))
                        if not abbr:
                            continue
                        pts = float(r["Points"]) if pd.notna(r.get("Points")) else 0
                        if abbr not in points_map:
                            points_map[abbr] = {
                                "abbreviation": abbr,
                                "fullName": str(r.get("FullName", "")),
                                "teamName": str(r.get("TeamName", "")),
                                "teamColor": f"#{r.get('TeamColor', 'ffffff')}",
                                "points": 0,
                            }
                        points_map[abbr]["points"] += pts
                except Exception:
                    continue

        standings = sorted(points_map.values(), key=lambda x: x["points"], reverse=True)
        for i, driver in enumerate(standings):
            driver["position"] = i + 1
        return standings

    try:
        return await run_blocking(_compute)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


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
    for driver_id in drivers:
        info = session.get_driver(driver_id)
        results.append({
            "abbreviation": info.get("Abbreviation", driver_id),
            "full_name": info.get("FullName", ""),
            "team": info.get("TeamName", ""),
            "number": info.get("DriverNumber", driver_id),
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
