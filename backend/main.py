import asyncio
import json
import os
import pathlib
import requests as _http
from concurrent.futures import ThreadPoolExecutor as _TPE
from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")
import random
import threading
import time
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
    cols = ["RoundNumber", "Country", "Location", "EventName", "OfficialEventName",
            "EventDate", "EventFormat", "Session1Date"]
    available = [c for c in cols if c in schedule.columns]
    return schedule[available].to_dict(orient="records")


# ---------------------------------------------------------------------------
# Historical – Laps
# ---------------------------------------------------------------------------

@app.get("/laps/{year}/{round_number}/{session_type}/{driver}")
async def get_driver_laps(year: int, round_number: int, session_type: str, driver: str, event_date: Optional[str] = None):
    """
    Return all laps for a driver in a session.
    session_type: 'Q' for qualifying, 'R' for race, 'FP1' / 'FP2' / 'FP3'
    driver: three-letter code e.g. 'VER', 'HAM'
    """
    def _load():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        real_round = _resolve_round(schedule, round_number, event_date)
        return load_session(year, real_round, session_type)

    try:
        session = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    if not session.drivers:
        raise HTTPException(status_code=404, detail="Lap data is not yet available for this session")

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
        if not name or str(name) in ("", "None", "nan"):
            continue
        date = event.get(f"Session{i}Date")
        date_str = None
        if date is not None and not pd.isna(date):
            if hasattr(date, 'isoformat'):
                date_str = date.isoformat()
            else:
                date_str = str(date)
        sessions.append({"index": i, "name": str(name), "date": date_str})
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
    try:
        laps = session.laps
    except Exception:
        return []
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
        is_practice = "practice" in n
        needs_messages = ("sprint" in n and "qualifying" in n) or "shootout" in n
        # Practice results are derived from laps; all others use session.results.
        s.load(laps=is_practice, telemetry=False, weather=False, messages=needs_messages)
        return s

    try:
        session = await run_blocking(_load)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    is_practice = "practice" in session_name.lower()
    if is_practice:
        rows = _build_results_from_laps(session)
        if not rows:
            raise HTTPException(
                status_code=404,
                detail="No lap data available yet for this session. "
                       "Results are usually available a few hours after the session ends."
            )
        return rows

    if session.results is not None and not session.results.empty:
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
# Historical – Championship position progression across rounds
# ---------------------------------------------------------------------------

@app.get("/championship-progression/{year}")
async def get_championship_progression(year: int):
    """
    Return championship position and cumulative points for every driver after each
    completed round of the season. Only rounds with at least one Race or Sprint
    session are included.
    """
    def _compute():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        schedule = schedule.sort_values("RoundNumber")

        # Normalise EventDate to timezone-naive for comparison
        dates = schedule["EventDate"].copy()
        if hasattr(dates.dt, "tz") and dates.dt.tz is not None:
            dates = dates.dt.tz_localize(None)
        now = pd.Timestamp.now()
        past = schedule[dates <= now]

        cumulative: dict = {}  # abbr -> {points, fullName, teamColor}
        rounds = []

        for _, event in past.iterrows():
            rn = int(event["RoundNumber"])
            short_name = str(event.get("EventName", f"Round {rn}")).replace(" Grand Prix", "").strip()

            round_had_data = False
            for i in range(1, 6):
                sess_name = event.get(f"Session{i}", "")
                if not sess_name or str(sess_name) in ("", "None", "nan"):
                    continue
                if str(sess_name).strip().lower() not in ("race", "sprint"):
                    continue
                try:
                    s = fastf1.get_session(year, rn, str(sess_name))
                    s.load(telemetry=False, weather=False, messages=False, laps=False)
                    if s.results is None or s.results.empty:
                        continue
                    for _, r in s.results.iterrows():
                        abbr = str(r.get("Abbreviation", ""))
                        if not abbr:
                            continue
                        pts = float(r["Points"]) if pd.notna(r.get("Points")) else 0
                        if abbr not in cumulative:
                            cumulative[abbr] = {
                                "points": 0,
                                "fullName": str(r.get("FullName", "")),
                                "teamColor": f"#{r.get('TeamColor', 'ffffff')}",
                            }
                        cumulative[abbr]["points"] += pts
                        round_had_data = True
                except Exception:
                    continue

            if not round_had_data:
                continue

            sorted_drivers = sorted(cumulative.items(), key=lambda x: x[1]["points"], reverse=True)
            drivers_snap = {}
            for pos, (abbr, data) in enumerate(sorted_drivers):
                drivers_snap[abbr] = {
                    "position": pos + 1,
                    "points": data["points"],
                    "fullName": data["fullName"],
                    "teamColor": data["teamColor"],
                }

            rounds.append({"round": rn, "name": short_name, "drivers": drivers_snap})

        return rounds

    try:
        return await run_blocking(_compute)
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Historical – Driver stats: championship + race + qualifying progressions
# ---------------------------------------------------------------------------

@app.get("/driver-stats/{year}")
async def get_driver_stats(year: int):
    """
    Return championship position progression, race finishing positions, and
    qualifying grid positions for all drivers across completed rounds.
    Race positions use the main Race only (no Sprint).
    Qualifying positions use the main Qualifying session only (no Sprint Qualifying/Shootout).
    """
    def _compute():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        schedule = schedule.sort_values("RoundNumber")

        dates = schedule["EventDate"].copy()
        if hasattr(dates.dt, "tz") and dates.dt.tz is not None:
            dates = dates.dt.tz_localize(None)
        now = pd.Timestamp.now()
        past = schedule[dates <= now]

        cumulative: dict = {}
        championship_rounds, race_rounds, quali_rounds = [], [], []
        sprint_rounds, sprint_quali_rounds = [], []

        for _, event in past.iterrows():
            rn = int(event["RoundNumber"])
            short_name = str(event.get("EventName", f"Round {rn}")).replace(" Grand Prix", "").strip()

            round_has_points = False
            race_drivers: dict = {}
            quali_drivers: dict = {}
            sprint_drivers: dict = {}
            sprint_quali_drivers: dict = {}

            for i in range(1, 6):
                sess_name = event.get(f"Session{i}", "")
                if not sess_name or str(sess_name) in ("", "None", "nan"):
                    continue
                n = str(sess_name).strip().lower()

                is_main_race   = (n == "race")
                is_sprint      = (n == "sprint")
                is_main_quali  = (n == "qualifying")
                is_sprint_quali = ("sprint" in n and "qualifying" in n) or "shootout" in n

                if not (is_main_race or is_sprint or is_main_quali or is_sprint_quali):
                    continue

                try:
                    s = fastf1.get_session(year, rn, str(sess_name))
                    s.load(telemetry=False, weather=False, messages=False, laps=False)
                    if s.results is None or s.results.empty:
                        continue

                    for _, r in s.results.iterrows():
                        abbr = str(r.get("Abbreviation", ""))
                        if not abbr:
                            continue
                        full_name = str(r.get("FullName", ""))
                        team_color = f"#{r.get('TeamColor', 'ffffff')}"

                        # Championship: accumulate points from Race + Sprint
                        if is_main_race or is_sprint:
                            pts = float(r["Points"]) if pd.notna(r.get("Points")) else 0
                            if abbr not in cumulative:
                                cumulative[abbr] = {"points": 0, "fullName": full_name, "teamColor": team_color}
                            cumulative[abbr]["points"] += pts
                            round_has_points = True

                        # Race finishing position (classified only)
                        if is_main_race:
                            try:
                                pos = int(str(r.get("ClassifiedPosition", "")).strip())
                                race_drivers[abbr] = {"position": pos, "fullName": full_name, "teamColor": team_color}
                            except (TypeError, ValueError):
                                pass

                        # Sprint finishing position (classified only)
                        if is_sprint:
                            try:
                                pos = int(str(r.get("ClassifiedPosition", "")).strip())
                                sprint_drivers[abbr] = {"position": pos, "fullName": full_name, "teamColor": team_color}
                            except (TypeError, ValueError):
                                pass

                        # Main qualifying grid position
                        if is_main_quali:
                            try:
                                pos = int(float(str(r.get("Position", "")).strip()))
                                quali_drivers[abbr] = {"position": pos, "fullName": full_name, "teamColor": team_color}
                            except (TypeError, ValueError):
                                pass

                        # Sprint qualifying / shootout position
                        if is_sprint_quali:
                            try:
                                pos = int(float(str(r.get("Position", "")).strip()))
                                sprint_quali_drivers[abbr] = {"position": pos, "fullName": full_name, "teamColor": team_color}
                            except (TypeError, ValueError):
                                pass

                except Exception:
                    continue

            if round_has_points:
                sorted_drivers = sorted(cumulative.items(), key=lambda x: x[1]["points"], reverse=True)
                snap = {
                    abbr: {
                        "position": pos + 1,
                        "points": data["points"],
                        "fullName": data["fullName"],
                        "teamColor": data["teamColor"],
                    }
                    for pos, (abbr, data) in enumerate(sorted_drivers)
                }
                championship_rounds.append({"round": rn, "name": short_name, "drivers": snap})

            if race_drivers:
                race_rounds.append({"round": rn, "name": short_name, "drivers": race_drivers})

            if quali_drivers:
                quali_rounds.append({"round": rn, "name": short_name, "drivers": quali_drivers})

            if sprint_drivers:
                sprint_rounds.append({"round": rn, "name": short_name, "drivers": sprint_drivers})

            if sprint_quali_drivers:
                sprint_quali_rounds.append({"round": rn, "name": short_name, "drivers": sprint_quali_drivers})

        return {
            "championship": championship_rounds,
            "race": race_rounds,
            "qualifying": quali_rounds,
            "sprint": sprint_rounds,
            "sprint_quali": sprint_quali_rounds,
        }

    try:
        return await run_blocking(_compute)
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Historical – Driver list for a session
# ---------------------------------------------------------------------------

@app.get("/drivers/{year}/{round_number}/{session_type}")
async def get_drivers(year: int, round_number: int, session_type: str, event_date: Optional[str] = None):
    """Return the list of drivers that participated in a session."""
    def _load():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        real_round = _resolve_round(schedule, round_number, event_date)
        return load_session(year, real_round, session_type)

    try:
        session = await run_blocking(_load)
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
# Schedule – Next upcoming session
# ---------------------------------------------------------------------------

@app.get("/next-event/{year}")
async def get_next_event(year: int):
    """
    Return the current or next upcoming session in the given season.
    A session that started within its expected duration is treated as live/current
    and is preferred over a future session. Returns {"next": null} when the season is over.
    """
    TARGET = {"race", "sprint", "qualifying", "sprint qualifying", "sprint shootout",
              "practice 1", "practice 2", "practice 3"}
    LABEL = {
        "race":            "Race",
        "sprint":          "Sprint Race",
        "qualifying":      "Qualifying",
        "sprint qualifying":"Sprint Qualy",
        "sprint shootout": "Sprint Qualy",
        "practice 1":      "Practice 1",
        "practice 2":      "Practice 2",
        "practice 3":      "Practice 3",
    }
    # Expected duration (minutes) per session type — used to decide if a session
    # that already started might still be running.
    DURATION = {
        "race": 120, "sprint": 45,
        "qualifying": 75, "sprint qualifying": 45, "sprint shootout": 45,
        "practice 1": 75, "practice 2": 75, "practice 3": 75,
    }

    def _compute():
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        schedule = schedule.sort_values("RoundNumber")
        now = pd.Timestamp.now(tz="UTC")
        current  = None  # most recent session that started and might still be running
        upcoming = None  # earliest session that hasn't started yet

        for _, event in schedule.iterrows():
            rn = int(event["RoundNumber"])
            short_name = str(event.get("EventName", f"Round {rn}")).replace(" Grand Prix", "").strip()
            country = str(event.get("Country", ""))
            location = str(event.get("Location", ""))
            event_date = event.get("EventDate")
            event_date_str = event_date.isoformat() if event_date is not None and not pd.isna(event_date) else None

            for i in range(1, 6):
                sess_name = event.get(f"Session{i}", "")
                sess_date = event.get(f"Session{i}Date")

                if not sess_name or str(sess_name) in ("", "None", "nan"):
                    continue
                if sess_date is None or pd.isna(sess_date):
                    continue

                n = str(sess_name).strip().lower()
                if n not in TARGET:
                    continue

                if sess_date.tzinfo is None:
                    sess_date = sess_date.tz_localize("UTC")

                candidate = {
                    "round": rn,
                    "name": short_name,
                    "country": country,
                    "location": location,
                    "session": LABEL.get(n, str(sess_name)),
                    "datetime": sess_date.isoformat(),
                    "eventDate": event_date_str,
                }

                if sess_date <= now:
                    # Session has started — check if it's likely still running
                    duration = pd.Timedelta(minutes=DURATION.get(n, 90))
                    if now <= sess_date + duration:
                        # Prefer the most recently started live session
                        if current is None or sess_date > pd.Timestamp(current["datetime"]):
                            current = candidate
                else:
                    # Future session — keep the earliest one
                    if upcoming is None or sess_date < pd.Timestamp(upcoming["datetime"]):
                        upcoming = candidate

        return current or upcoming

    try:
        result = await run_blocking(_compute)
        return {"next": result}
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# AI Predictions
# ---------------------------------------------------------------------------

_PREDICTIONS_CACHE_DIR = pathlib.Path("cache/predictions")


def _load_prediction_cache(year: int, round_number: int) -> dict | None:
    path = _PREDICTIONS_CACHE_DIR / f"{year}_{round_number}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def _save_prediction_cache(year: int, round_number: int, data: dict) -> None:
    _PREDICTIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _PREDICTIONS_CACHE_DIR / f"{year}_{round_number}.json"
    with open(path, "w") as f:
        json.dump(data, f)


def _gather_prediction_context(year: int, round_number: int) -> dict:
    """Collect recent race results, per-driver form, circuit history, and standings."""
    schedule = fastf1.get_event_schedule(year, include_testing=False)

    row = schedule[schedule["RoundNumber"] == round_number]
    if row.empty:
        raise ValueError(f"Round {round_number} not found in {year} schedule")
    event = row.iloc[0]
    race_name = str(event.get("EventName", f"Round {round_number}"))
    circuit   = str(event.get("Location", ""))
    country   = str(event.get("Country", ""))

    # Last 5 completed races — all finishers, not just top 10
    past = schedule[schedule["RoundNumber"] < round_number].tail(5)
    recent_results = []
    for _, prev_event in past.iterrows():
        rn = int(prev_event["RoundNumber"])
        name = str(prev_event.get("EventName", f"Round {rn}")).replace(" Grand Prix", "").strip()
        try:
            s = fastf1.get_session(year, rn, "Race")
            s.load(telemetry=False, weather=False, messages=False, laps=False)
            if s.results is None or s.results.empty:
                continue
            drivers = []
            for _, r in s.results.iterrows():
                abbr = str(r.get("Abbreviation", ""))
                if not abbr:
                    continue
                try:
                    pos = int(str(r.get("ClassifiedPosition", "")).strip())
                except (ValueError, TypeError):
                    pos = None
                status = str(r.get("Status", ""))
                dnf = pos is None or (
                    status not in ("Finished",)
                    and not status.startswith("+")
                    and not status.startswith("Lap")
                )
                drivers.append({
                    "position": pos,
                    "driver":   abbr,
                    "team":     str(r.get("TeamName", "")),
                    "dnf":      dnf,
                })
            drivers.sort(key=lambda x: (x["dnf"], x["position"] or 99))
            recent_results.append({"race": name, "results": drivers})
        except Exception:
            continue

    # Current standings (points from all Race + Sprint sessions before this round)
    points_map: dict = {}
    for _, prev_event in schedule[schedule["RoundNumber"] < round_number].iterrows():
        rn = int(prev_event["RoundNumber"])
        for i in range(1, 6):
            sess_name = prev_event.get(f"Session{i}", "")
            if not sess_name or str(sess_name).strip().lower() not in ("race", "sprint"):
                continue
            try:
                s = fastf1.get_session(year, rn, str(sess_name))
                s.load(telemetry=False, weather=False, messages=False, laps=False)
                if s.results is None or s.results.empty:
                    continue
                for _, r in s.results.iterrows():
                    abbr = str(r.get("Abbreviation", ""))
                    if not abbr:
                        continue
                    pts = float(r["Points"]) if pd.notna(r.get("Points")) else 0
                    if abbr not in points_map:
                        points_map[abbr] = {"driver": abbr, "team": str(r.get("TeamName", "")), "points": 0}
                    points_map[abbr]["points"] += pts
            except Exception:
                continue
    standings = sorted(points_map.values(), key=lambda x: x["points"], reverse=True)[:10]

    # Circuit history: same race in the previous 3 seasons
    circuit_history = []
    for hist_year in range(year - 3, year):
        try:
            hist_schedule = fastf1.get_event_schedule(hist_year, include_testing=False)
            match = hist_schedule[hist_schedule["Location"].str.lower() == circuit.lower()]
            if match.empty:
                match = hist_schedule[hist_schedule["Country"].str.lower() == country.lower()]
            if match.empty:
                continue
            hist_rn = int(match.iloc[0]["RoundNumber"])
            s = fastf1.get_session(hist_year, hist_rn, "Race")
            s.load(telemetry=False, weather=False, messages=False, laps=False)
            if s.results is None or s.results.empty:
                continue
            top10 = []
            for _, r in s.results.iterrows():
                try:
                    pos = int(str(r.get("ClassifiedPosition", "")).strip())
                except (ValueError, TypeError):
                    continue
                if pos <= 10:
                    top10.append({
                        "position": pos,
                        "driver":   str(r.get("Abbreviation", "")),
                        "team":     str(r.get("TeamName", "")),
                    })
            top10.sort(key=lambda x: x["position"])
            if top10:
                circuit_history.append({"year": hist_year, "results": top10})
        except Exception:
            continue

    return {
        "race_name":       race_name,
        "circuit":         circuit,
        "country":         country,
        "round":           round_number,
        "year":            year,
        "recent_results":  recent_results,
        "standings":       standings,
        "circuit_history": circuit_history,
    }


def _call_anthropic(context: dict) -> dict:
    try:
        import anthropic
    except ImportError:
        raise ValueError("anthropic package not installed — run: pip install anthropic")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set")

    standings_str = "\n".join(
        f"  {i+1}. {d['driver']} ({d['team']}) – {d['points']} pts"
        for i, d in enumerate(context["standings"])
    )

    # Per-driver form: collect positions across all recent races (oldest → newest)
    driver_form: dict = {}  # abbr -> [label, ...]
    driver_teams: dict = {}
    for race in context["recent_results"]:
        seen: set = set()
        for r in race["results"]:
            abbr = r["driver"]
            if abbr in seen:
                continue
            seen.add(abbr)
            driver_teams[abbr] = r["team"]
            label = "DNF" if r["dnf"] else f"P{r['position']}"
            driver_form.setdefault(abbr, []).append(label)
    form_lines = [
        f"  {abbr} ({driver_teams.get(abbr, '')}): {', '.join(positions)}"
        for abbr, positions in sorted(driver_form.items())
    ]
    form_str = "\n".join(form_lines) if form_lines else "  No recent data available"

    # Full race classifications
    recent_lines = []
    for r in context["recent_results"]:
        finishers = ", ".join(
            f"{x['position']}. {x['driver']}" for x in r["results"] if not x["dnf"]
        )
        dnfs = ", ".join(x["driver"] for x in r["results"] if x["dnf"])
        line = f"  {r['race']}: {finishers}"
        if dnfs:
            line += f"  [DNF: {dnfs}]"
        recent_lines.append(line)
    recent_str = "\n".join(recent_lines) if recent_lines else "  No recent results available"

    # Circuit history
    hist_lines = []
    for h in context.get("circuit_history", []):
        top5 = ", ".join(
            f"{x['position']}. {x['driver']} ({x['team']})" for x in h["results"][:5]
        )
        hist_lines.append(f"  {h['year']}: {top5}")
    hist_str = "\n".join(hist_lines) if hist_lines else "  No historical data available for this circuit"

    # All known drivers (union of standings + recent results)
    all_drivers: dict = {}
    for race in context["recent_results"]:
        for r in race["results"]:
            if r["driver"] and r["driver"] not in all_drivers:
                all_drivers[r["driver"]] = r["team"]
    for d in context["standings"]:
        if d["driver"] not in all_drivers:
            all_drivers[d["driver"]] = d["team"]
    drivers_str = ", ".join(
        f"{abbr} ({team})" for abbr, team in sorted(all_drivers.items())
    ) or "Unknown — use your best knowledge of the current grid"

    prompt = f"""You are an F1 race analyst. Predict the outcome of the upcoming {context['year']} {context['race_name']} at {context['circuit']}, {context['country']}.

Current Championship Standings (Top 10):
{standings_str}

Driver Recent Form (last {len(context['recent_results'])} races, oldest → most recent):
{form_str}

Full Race Classifications (last {len(context['recent_results'])} races):
{recent_str}

Same Circuit — Race Results from Previous Seasons:
{hist_str}

Known Drivers on the Grid: {drivers_str}

Respond with a JSON object only — no markdown fences, no text outside the JSON — using exactly this structure:
{{
  "podium": [
    {{"position": 1, "driver": "<3-letter code>", "team": "<team>", "rationale": "<1-2 sentences>"}},
    {{"position": 2, "driver": "<3-letter code>", "team": "<team>", "rationale": "<1-2 sentences>"}},
    {{"position": 3, "driver": "<3-letter code>", "team": "<team>", "rationale": "<1-2 sentences>"}}
  ],
  "dnf_risks": [
    {{"driver": "<3-letter code>", "team": "<team>", "reason": "<1 sentence>"}}
  ],
  "dark_horse": {{"driver": "<3-letter code>", "team": "<team>", "rationale": "<1-2 sentences>"}},
  "summary": "<2-3 sentence race preview>",
  "predicted_race_order": [
    {{"position": 1, "driver": "<3-letter code>", "team": "<team>"}},
    {{"position": 2, "driver": "<3-letter code>", "team": "<team>"}}
  ],
  "predicted_quali_order": [
    {{"position": 1, "driver": "<3-letter code>", "team": "<team>"}},
    {{"position": 2, "driver": "<3-letter code>", "team": "<team>"}}
  ]
}}
Include all drivers in predicted_race_order and predicted_quali_order (up to 22 entries each), ordered 1st to last."""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences that Haiku sometimes adds despite instructions
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()
    return json.loads(raw)


@app.get("/predictions/{year}/{round_number}")
async def get_race_predictions(year: int, round_number: int, force: bool = False):
    """
    Return AI-generated predictions for the given race round.
    The first call fetches data and queries Claude; subsequent calls return the
    cached result from cache/predictions/{year}_{round_number}.json.
    Pass ?force=true to bypass the cache and regenerate.
    """
    if not force:
        cached = _load_prediction_cache(year, round_number)
        if cached:
            return cached

    def _generate():
        context    = _gather_prediction_context(year, round_number)
        prediction = _call_anthropic(context)
        result = {
            "generated_at": pd.Timestamp.now().isoformat(),
            "year":         year,
            "round":        round_number,
            "race_name":    context["race_name"],
            "circuit":      context["circuit"],
            "country":      context["country"],
            **prediction,
        }
        _save_prediction_cache(year, round_number, result)
        return result

    try:
        return await run_blocking(_generate)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Claude returned invalid JSON: {e}")
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


# ---------------------------------------------------------------------------
# Driver Profile  (Jolpica / Ergast API)
# ---------------------------------------------------------------------------

_JOLPICA = "https://api.jolpi.ca/ergast/f1"

_DRIVER_ID_MAP = {
    # 2026 active grid
    "VER": "max_verstappen", "NOR": "norris",    "LEC": "leclerc",
    "PIA": "piastri",        "RUS": "russell",   "ANT": "antonelli",
    "HAM": "hamilton",       "SAI": "sainz",     "ALO": "alonso",
    "STR": "stroll",         "GAS": "gasly",     "OCO": "ocon",
    "HUL": "hulkenberg",     "HAD": "hadjar",    "LAW": "lawson",
    "COL": "colapinto",      "ALB": "albon",     "BEA": "bearman",
    "BOR": "bortoleto",      "LIN": "lindblad",
    # Recent historical (2014–2025)
    "BOT": "bottas",         "PER": "perez",     "VET": "vettel",
    "RIC": "ricciardo",      "TSU": "tsunoda",   "MAG": "kevin_magnussen",
    "MSC": "mick_schumacher","ZHO": "zhou",      "DEV": "de_vries",
    "SAR": "sargeant",       "LAT": "latifi",    "MAZ": "mazepin",
    "GIO": "giovinazzi",     "RAI": "raikkonen", "KUB": "kubica",
    "GRO": "grosjean",       "KVY": "kvyat",     "ERI": "ericsson",
    "HAR": "hartley",        "SIR": "sirotkin",  "BUT": "button",
    "ROS": "rosberg",        "MAS": "massa",     "WEB": "webber",
}

_JUNIOR_CAREER = {
    "VER": ["Karting (2005–2012)", "Formula Ford 1600 (2014)", "FIA European F3 (2014) – 3rd"],
    "HAM": ["Karting (1993–2000)", "Formula Renault UK (2002) – Champion", "Formula Three Euro Series (2005) – Champion", "GP2 Series (2006) – Champion"],
    "LEC": ["Karting (2009–2014)", "FIA European F3 (2015) – Champion", "GP3 Series (2016) – Champion", "FIA Formula 2 (2017) – Champion"],
    "NOR": ["Karting (2010–2014)", "MSA Formula (2015) – Champion", "FIA European F3 (2017) – Champion", "FIA Formula 2 (2018) – 2nd"],
    "RUS": ["Karting (2007–2014)", "FIA European F3 (2017) – Champion", "FIA Formula 2 (2018) – Champion"],
    "SAI": ["Karting (2006–2012)", "Formula Renault 2.0 Alps (2012)", "Formula Renault 3.5 (2014) – Champion"],
    "PIA": ["Karting (2012–2018)", "Toyota Racing Series (2019) – Champion", "FIA Formula 2 (2021) – Champion"],
    "ALO": ["Karting (1991–1999)", "Formula Nissan (1999) – Champion", "Euro Open by Nissan (2000) – Champion"],
    "ANT": ["Karting (2015–2022)", "Italian F4 (2022) – Champion", "Formula Regional European (2023) – Champion", "FIA Formula 2 (2024) – Champion"],
    "STR": ["Karting (2011–2015)", "Italian F4 (2015) – Champion", "FIA European F3 (2016) – Champion"],
    "GAS": ["Karting (2007–2012)", "Formula Renault 2.0 (2012) – 3rd", "Formula Renault 3.5 (2014) – Champion"],
    "OCO": ["Karting (2008–2013)", "German F4 (2014) – Champion", "GP3 Series (2015) – Champion", "FIA Formula 2 (2016) – 2nd"],
    "HUL": ["Formula BMW (2003) – European Champion", "Formula Three (2004–2005)", "Formula Renault 3.5 (2005) – 4th"],
    "HAD": ["Karting (2016–2022)", "ADAC F4 (2022) – Champion", "FIA Formula 3 (2023) – 3rd", "FIA Formula 2 (2024) – Champion"],
    "LAW": ["Karting (2010–2017)", "Toyota Racing Series (2018)", "FIA Formula 3 (2019) – 5th", "FIA Formula 2 (2021) – Champion"],
    "ALB": ["Karting (2010–2014)", "GP3 Series (2016) – Champion", "FIA Formula 2 (2018) – 5th"],
    "BEA": ["Karting (2015–2019)", "Italian F4 (2020) – Champion", "FIA Formula 3 (2022) – 3rd", "FIA Formula 2 (2023) – 2nd"],
    "BOR": ["Karting (2013–2019)", "FIA Formula 2 (2022) – 3rd", "FIA Formula 2 (2023) – Champion"],
    "COL": ["Karting (2013–2017)", "FIA Formula 2 (2021) – 6th", "FIA Formula 2 (2022) – 3rd"],
    "LIN": ["Karting (2016–2022)", "FIA Formula 4 (2022) – Nordic Champion", "Formula Regional European (2023) – 3rd", "FIA Formula 3 (2024) – 3rd"],
}


@app.get("/driver/{code}")
async def get_driver_profile(code: str):
    """Return a complete driver profile: bio, F1 season record, and H2H vs teammates."""
    code = code.upper()

    cache_path = pathlib.Path(f"cache/driver/{code}.json")
    if cache_path.exists():
        age_h = (time.time() - cache_path.stat().st_mtime) / 3600
        if age_h < 24:
            with open(cache_path) as f:
                return json.load(f)

    driver_id = _DRIVER_ID_MAP.get(code)
    if not driver_id:
        raise HTTPException(status_code=404, detail=f"Unknown driver code: {code}")

    def _jget(path: str) -> dict:
        r = _http.get(f"{_JOLPICA}{path}", timeout=15)
        r.raise_for_status()
        return r.json()["MRData"]

    def _build() -> dict:
        # 1. Biographical info
        try:
            drivers_list = _jget(f"/drivers/{driver_id}.json")["DriverTable"]["Drivers"]
            info = drivers_list[0] if drivers_list else {}
        except Exception:
            info = {}

        # 2. Season-by-season standings
        try:
            standings_list = _jget(f"/drivers/{driver_id}/driverStandings.json?limit=100")["StandingsTable"]["StandingsLists"]
        except Exception:
            standings_list = []

        # 3. All race results
        try:
            race_list = _jget(f"/drivers/{driver_id}/results.json?limit=1000")["RaceTable"]["Races"]
        except Exception:
            race_list = []

        # 4. All qualifying results
        try:
            quali_list = _jget(f"/drivers/{driver_id}/qualifying.json?limit=1000")["RaceTable"]["Races"]
        except Exception:
            quali_list = []

        # --- Season record ---
        races_by_year: dict = {}
        for race in race_list:
            races_by_year.setdefault(race["season"], []).append(race)

        seasons = []
        for sl in standings_list:
            yr = sl["season"]
            ds = sl["DriverStandings"][0]
            yr_races = races_by_year.get(yr, [])
            poles = sum(
                1 for r in yr_races
                for res in r.get("Results", [])
                if res.get("grid") == "1"
            )
            podiums = sum(
                1 for r in yr_races
                for res in r.get("Results", [])
                if res.get("positionText", "").isdigit() and int(res["positionText"]) <= 3
            )
            teams_seen = list(dict.fromkeys(
                res["Constructor"]["name"]
                for r in yr_races for res in r.get("Results", [])
            ))
            team_str = " / ".join(teams_seen) if teams_seen else (
                ds["Constructors"][-1]["name"] if ds.get("Constructors") else ""
            )
            seasons.append({
                "year": int(yr), "team": team_str,
                "races": len(yr_races), "wins": int(ds["wins"]),
                "poles": poles, "podiums": podiums,
                "points": float(ds["points"]), "position": int(ds["position"]),
            })
        seasons.sort(key=lambda x: x["year"])

        # --- H2H ---
        # Unique (year, constructor) pairs from race results
        year_constructors: dict = {}
        for race in race_list:
            yr = race["season"]
            for res in race.get("Results", []):
                year_constructors.setdefault(yr, set()).add(res["Constructor"]["constructorId"])

        # Season-level standings for all drivers (one call per year, concurrent)
        def _fetch_season_standings(yr):
            try:
                data = _jget(f"/{yr}/driverStandings.json")["StandingsTable"]["StandingsLists"]
                if data:
                    return yr, {e["Driver"].get("code", ""): float(e["points"]) for e in data[0]["DriverStandings"]}
            except Exception:
                pass
            return yr, {}

        all_yr_standings: dict = {}
        unique_years = list(year_constructors.keys())
        with _TPE(max_workers=6) as ex:
            for yr, pts_map in ex.map(_fetch_season_standings, unique_years):
                all_yr_standings[yr] = pts_map

        # Per-(year, constructor) H2H
        def _h2h_for_pair(pair):
            yr, con_id = pair
            try:
                c_races = _jget(f"/{yr}/constructors/{con_id}/results.json?limit=100")["RaceTable"]["Races"]
                c_quali = _jget(f"/{yr}/constructors/{con_id}/qualifying.json?limit=100")["RaceTable"]["Races"]
            except Exception:
                return None
            if not c_races:
                return None

            # Primary teammate = most races driven alongside this driver
            tm_count: dict = {}
            for race in c_races:
                for res in race.get("Results", []):
                    dc = res["Driver"].get("code", "")
                    if dc and dc != code:
                        tm_count[dc] = tm_count.get(dc, 0) + 1
            if not tm_count:
                return None
            tm_code = max(tm_count, key=tm_count.get)

            tm_name = ""
            for race in c_races:
                for res in race.get("Results", []):
                    if res["Driver"].get("code") == tm_code:
                        d = res["Driver"]
                        tm_name = f"{d.get('givenName','')} {d.get('familyName','')}".strip()
                        break
                if tm_name:
                    break

            # Race H2H
            r_wins = r_losses = r_dnc = 0
            for race in c_races:
                my_r = tm_r = None
                for res in race.get("Results", []):
                    dc = res["Driver"].get("code", "")
                    if dc == code:
                        my_r = res
                    elif dc == tm_code:
                        tm_r = res
                if not my_r or not tm_r:
                    continue
                my_pt, tm_pt = my_r.get("positionText", ""), tm_r.get("positionText", "")
                my_cls, tm_cls = my_pt.isdigit(), tm_pt.isdigit()
                if my_cls and tm_cls:
                    if int(my_pt) < int(tm_pt):
                        r_wins += 1
                    else:
                        r_losses += 1
                elif my_cls:
                    r_wins += 1
                elif tm_cls:
                    r_losses += 1
                else:
                    r_dnc += 1

            if r_wins + r_losses + r_dnc == 0:
                return None

            # Qualifying H2H
            q_wins = q_losses = q_dnc = 0
            for race in c_quali:
                my_q = tm_q = None
                for res in race.get("QualifyingResults", []):
                    dc = res["Driver"].get("code", "")
                    if dc == code:
                        my_q = res
                    elif dc == tm_code:
                        tm_q = res
                if not my_q or not tm_q:
                    continue
                try:
                    if int(my_q["position"]) < int(tm_q["position"]):
                        q_wins += 1
                    else:
                        q_losses += 1
                except (ValueError, KeyError):
                    q_dnc += 1

            yr_pts = all_yr_standings.get(yr, {})
            return {
                "year": int(yr), "constructor": con_id,
                "teammate": tm_code, "teammate_name": tm_name,
                "race_wins": r_wins, "race_losses": r_losses, "race_dnc": r_dnc,
                "quali_wins": q_wins, "quali_losses": q_losses, "quali_dnc": q_dnc,
                "points": float(yr_pts.get(code, 0)),
                "teammate_points": float(yr_pts.get(tm_code, 0)),
            }

        pairs = [(yr, con) for yr, cons in year_constructors.items() for con in cons]
        h2h = []
        with _TPE(max_workers=6) as ex:
            for result in ex.map(_h2h_for_pair, pairs):
                if result is not None:
                    h2h.append(result)
        h2h.sort(key=lambda x: x["year"])

        full_name = f"{info.get('givenName','')} {info.get('familyName','')}".strip() or code
        profile = {
            "code": code,
            "full_name": full_name,
            "nationality": info.get("nationality", ""),
            "date_of_birth": info.get("dateOfBirth", ""),
            "number": info.get("permanentNumber", ""),
            "url": info.get("url", ""),
            "junior_career": _JUNIOR_CAREER.get(code, []),
            "seasons": seasons,
            "h2h": h2h,
        }

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(profile, f, indent=2)
        return profile

    try:
        return await run_blocking(_build)
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"{e}\n{traceback.format_exc()}")


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

def _make_routing_client(ext_loop: asyncio.AbstractEventLoop, ext_queue: asyncio.Queue):
    """
    Return a SignalRClient subclass that pushes messages directly into ext_queue
    instead of writing to a file. FastF1 3.x writes str(msg) (Python repr, not JSON)
    to its output file, so bypassing the file is both simpler and correct.
    """
    import os
    from fastf1.livetiming.client import SignalRClient

    class _RoutingClient(SignalRClient):
        async def _on_message(self, msg):
            self._t_last_message = time.time()
            try:
                payload = json.dumps({"type": "timing_live", "data": msg})
            except (TypeError, ValueError):
                payload = json.dumps({"type": "timing_live", "data": str(msg)})
            ext_loop.call_soon_threadsafe(ext_queue.put_nowait, payload)

    return _RoutingClient(filename=os.devnull, timeout=60)


class _LiveBridge:
    """Runs FastF1's SignalR client in a daemon thread, routing messages to asyncio."""

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._queue = queue
        self._stop = threading.Event()

    def run(self):
        max_attempts = 3
        for attempt in range(max_attempts):
            if self._stop.is_set():
                break
            try:
                client = _make_routing_client(self._loop, self._queue)
                client.start()  # blocks until session ends or timeout
                break
            except Exception as exc:
                if attempt < max_attempts - 1 and not self._stop.is_set():
                    time.sleep(2 ** attempt)
                    continue
                detail = str(exc)
                if "Expecting value" in detail or "JSONDecodeError" in detail:
                    detail = (
                        "Could not connect to the F1 live timing service. "
                        "The service may not be active yet, or returned an unexpected "
                        f"response. Try again in a few seconds. (Internal: {detail})"
                    )
                self._loop.call_soon_threadsafe(
                    self._queue.put_nowait,
                    json.dumps({"type": "error", "detail": detail}),
                )

    def stop(self):
        self._stop.set()


@app.websocket("/ws/live-replay")
async def live_timing_replay(
    websocket: WebSocket,
    year: int = 2025,
    round_number: int = 1,
    session_name: str = "Qualifying",
    speed: float = 10.0,
):
    """
    Stream a historical qualifying/practice session as synthetic live timing events.
    Loads a cached FastF1 session and re-emits lap events in chronological order,
    sleeping proportionally to real elapsed time scaled by `speed`.

    speed=10 → 10× faster than real time.
    """
    await websocket.accept()

    def _load():
        s = fastf1.get_session(year, round_number, session_name)
        s.load(laps=True, telemetry=False, weather=False, messages=False)
        return s

    try:
        session = await run_blocking(_load)
    except Exception as exc:
        await websocket.send_text(json.dumps({"type": "error", "detail": str(exc)}))
        return

    laps = session.laps
    if laps is None or laps.empty:
        await websocket.send_text(json.dumps({"type": "error", "detail": "No lap data available for this session"}))
        return

    # Build driver info map
    driver_info: dict = {}
    for drv_id in session.drivers:
        try:
            info = session.get_driver(drv_id)
            abbr = str(info.get("Abbreviation", drv_id))
            driver_info[abbr] = {
                "abbreviation": abbr,
                "fullName": str(info.get("FullName", "")),
                "teamName": str(info.get("TeamName", "")),
                "teamColor": f"#{info.get('TeamColor', 'ffffff')}",
                "driverNumber": str(info.get("DriverNumber", drv_id)),
            }
        except Exception:
            continue

    # Classify session type
    name_lower = session_name.lower()
    is_practice    = "practice" in name_lower or name_lower.startswith("fp")
    is_race        = name_lower == "race"
    is_sprint_race = name_lower == "sprint"
    is_sprint_quali = ("sprint" in name_lower and "qualifying" in name_lower) or "shootout" in name_lower

    if is_practice:
        segment_names = ["P"]
        session_type = "practice"
    elif is_race:
        segment_names = ["Race"]
        session_type = "race"
    elif is_sprint_race:
        segment_names = ["Sprint"]
        session_type = "sprint"
    elif is_sprint_quali:
        segment_names = ["SQ1", "SQ2", "SQ3"]
        session_type = "sprint_quali"
    else:
        segment_names = ["Q1", "Q2", "Q3"]
        session_type = "quali"

    # Filter valid timed laps
    desired_cols = ["Driver", "LapTime", "Sector1Time", "Sector2Time", "Sector3Time",
                    "LapStartTime", "Compound", "TyreLife", "PitOutTime"]
    available_cols = [c for c in desired_cols if c in laps.columns]
    timed = laps[laps["LapTime"].notna()][available_cols].copy()

    if timed.empty or "LapStartTime" not in timed.columns:
        await websocket.send_text(json.dumps({"type": "error", "detail": "Insufficient lap data for replay"}))
        return

    timed = timed.sort_values("LapStartTime").reset_index(drop=True)

    def _td_sec(td) -> float | None:
        try:
            if pd.isna(td):
                return None
        except (TypeError, ValueError):
            return None
        return float(td.total_seconds())

    def _lapstr(secs: float | None) -> str | None:
        if secs is None:
            return None
        mins = int(secs // 60)
        rest = secs % 60
        return f"{mins}:{rest:06.3f}" if mins > 0 else f"{rest:.3f}"

    start_times_sec = timed["LapStartTime"].apply(_td_sec)

    # Detect segment boundaries: consecutive gap > 3 minutes means new segment
    seg_labels: list[str] = []
    seg_idx = 0
    for i in range(len(timed)):
        if i > 0:
            prev = start_times_sec.iloc[i - 1] or 0.0
            curr = start_times_sec.iloc[i] or 0.0
            if curr - prev > 180:
                seg_idx = min(seg_idx + 1, len(segment_names) - 1)
        seg_labels.append(segment_names[seg_idx])
    timed["Segment"] = seg_labels

    # Build a flat sorted event list at mini-sector granularity.
    # Each main sector (S1, S2, S3) generates 3 events: two intermediate mini-sector
    # completions (at 1/3 and 2/3 of the sector time) plus the sector completion itself.
    # Sorting by completion time means concurrent laps from different drivers interleave
    # correctly, giving the replica the same event ordering as real live timing.
    _F = [False, False, False]  # shorthand for all-bars-off
    _T = [True, True, True]     # shorthand for all-bars-on

    def _mini_split(total: float, seed: int) -> tuple[float, float, float]:
        """Split a sector time into 3 unequal mini-bar times that sum to total.
        Deterministic per (driver, lap, sector) so replay is reproducible."""
        rng = random.Random(seed)
        a = 1/3 + rng.uniform(-0.07, 0.07)
        b = 1/3 + rng.uniform(-0.07, 0.07)
        a = max(0.15, min(0.55, a))
        b = max(0.15, min(0.55, b))
        c = max(0.10, 1.0 - a - b)
        s = a + b + c
        m1 = round(total * a / s, 3)
        m2 = round(total * b / s, 3)
        m3 = round(total - m1 - m2, 3)
        return m1, m2, m3

    events_list: list[dict] = []
    for lap_idx, (_, row) in enumerate(timed.iterrows()):
        abbr = str(row["Driver"])
        seg = str(row["Segment"])
        lap_start = _td_sec(row.get("LapStartTime"))
        if lap_start is None:
            continue

        s1 = _td_sec(row.get("Sector1Time"))
        s2 = _td_sec(row.get("Sector2Time"))
        s3 = _td_sec(row.get("Sector3Time"))
        lap_sec = _td_sec(row["LapTime"])

        compound_raw = row.get("Compound", "")
        compound = str(compound_raw) if pd.notna(compound_raw) else "UNKNOWN"
        tire_age_raw = row.get("TyreLife", 0)
        tire_age = int(tire_age_raw) if pd.notna(tire_age_raw) else 0
        is_pit_out = _td_sec(row.get("PitOutTime")) is not None

        s1m1, s1m2, s1m3 = _mini_split(s1, hash((abbr, lap_idx, 1))) if s1 is not None else (None, None, None)
        s2m1, s2m2, s2m3 = _mini_split(s2, hash((abbr, lap_idx, 2))) if s2 is not None else (None, None, None)
        s3m1, s3m2, s3m3 = _mini_split(s3, hash((abbr, lap_idx, 3))) if s3 is not None else (None, None, None)

        base = {"abbr": abbr, "seg": seg, "compound": compound, "tireAge": tire_age,
                "s1": s1, "s2": s2, "s3": s3,
                "s1m1": s1m1, "s1m2": s1m2, "s1m3": s1m3,
                "s2m1": s2m1, "s2m2": s2m2, "s2m3": s2m3,
                "s3m1": s3m1, "s3m2": s3m2, "s3m3": s3m3,
                "isPitOut": is_pit_out}

        if s1 is not None:
            events_list.append({**base, "sessionTime": lap_start + s1m1,         "ev": "s1m1"})
            events_list.append({**base, "sessionTime": lap_start + s1m1 + s1m2,  "ev": "s1m2"})
            events_list.append({**base, "sessionTime": lap_start + s1,            "ev": "s1"})

            if s2 is not None:
                events_list.append({**base, "sessionTime": lap_start + s1 + s2m1,        "ev": "s2m1"})
                events_list.append({**base, "sessionTime": lap_start + s1 + s2m1 + s2m2, "ev": "s2m2"})
                events_list.append({**base, "sessionTime": lap_start + s1 + s2,           "ev": "s2"})

                if lap_sec is not None:
                    if s3 is not None:
                        events_list.append({**base, "sessionTime": lap_start + s1 + s2 + s3m1,        "ev": "s3m1"})
                        events_list.append({**base, "sessionTime": lap_start + s1 + s2 + s3m1 + s3m2, "ev": "s3m2"})
                    events_list.append({**base, "sessionTime": lap_start + lap_sec,
                                        "ev": "full", "lapSec": lap_sec})

    events_list.sort(key=lambda e: e["sessionTime"])

    # Last event time per segment — used by the frontend countdown timer
    segment_end_times: dict = {}
    for ev in events_list:
        s, t = ev["seg"], ev["sessionTime"]
        if s not in segment_end_times or t > segment_end_times[s]:
            segment_end_times[s] = round(t, 1)

    # Send session metadata to client
    try:
        await websocket.send_text(json.dumps({
            "type": "session_info",
            "year": year,
            "round": round_number,
            "sessionName": session_name,
            "sessionType": session_type,
            "segments": segment_names,
            "segmentEndTimes": segment_end_times,
            "raceName": str(v) if pd.notna(v := session.event.get("EventName", "")) else "",
            "country":  str(v) if pd.notna(v := session.event.get("Country",    "")) else "",
            "location": str(v) if pd.notna(v := session.event.get("Location",   "")) else "",
        }))
    except WebSocketDisconnect:
        return

    # best[seg][abbr] – best complete lap per driver per segment
    best: dict = {seg: {} for seg in segment_names}
    # last_lap[seg][abbr] – most recently completed lap time per driver per segment
    last_lap: dict = {seg: {} for seg in segment_names}
    # sector_hist[seg][abbr] – ALL completed sector times per driver: {"s1": [...], "s2": [...], "s3": [...]}
    # Updated at lap completion; used at render time to compute colors dynamically.
    sector_hist: dict = {seg: {} for seg in segment_names}
    # overall_best[seg] – fastest sector time seen across ALL drivers in the segment
    overall_best: dict = {seg: {"s1": None, "s2": None, "s3": None} for seg in segment_names}
    # mini_hist[seg][abbr][key] – completed mini-bar times per driver per segment
    # keys: s1m1, s1m2, s1m3, s2m1, s2m2, s2m3, s3m1, s3m2, s3m3
    _MINI_KEYS = ["s1m1","s1m2","s1m3","s2m1","s2m2","s2m3","s3m1","s3m2","s3m3"]
    mini_hist: dict = {seg: {} for seg in segment_names}
    mini_overall: dict = {seg: {k: None for k in _MINI_KEYS} for seg in segment_names}
    # current_lap[abbr] – live in-progress state per driver (cleared on segment change)
    # Stores timing/bar state + mini-bar times; colors computed at render time.
    current_lap: dict = {}
    current_seg = segment_names[0]
    prev_time: float | None = None

    def _upd_mini(seg: str, abbr: str, key: str, val: float) -> None:
        mini_hist[seg].setdefault(abbr, {}).setdefault(key, []).append(val)
        if mini_overall[seg][key] is None or val < mini_overall[seg][key]:
            mini_overall[seg][key] = val

    def _ensure(a: str, cpd: str, age: int) -> None:
        if a not in current_lap:
            current_lap[a] = {
                "s1": None, "s2": None, "s3": None,
                "s1m1": None, "s1m2": None, "s1m3": None,
                "s2m1": None, "s2m2": None, "s2m3": None,
                "s3m1": None, "s3m2": None, "s3m3": None,
                "s1Bars": list(_F), "s2Bars": list(_F), "s3Bars": list(_F),
                "compound": cpd, "tireAge": age, "inProgress": True,
            }

    def _build_snapshot(seg: str, ev_abbr: str, ev_type: str,
                        just_improved: bool, session_time: float) -> str:
        seg_best = best[seg]

        # Colors are always computed fresh from the current sector_hist / overall_best.
        # This guarantees exactly one driver has purple per sector at any moment.
        def _render_s_color(a: str, val: float, key: str) -> str:
            ob = overall_best[seg][key]
            if ob is None or val <= ob:
                return "purple"
            hist = sector_hist[seg].get(a, {}).get(key, [])
            if not hist or val <= min(hist):
                return "green"
            return "yellow"

        def _render_m_color(a: str, val: float, key: str) -> str:
            ob = mini_overall[seg][key]
            if ob is None or val <= ob:
                return "purple"
            hist = mini_hist[seg].get(a, {}).get(key, [])
            if not hist or val <= min(hist):
                return "green"
            return "yellow"

        def _bc(a: str, src: dict, k1: str, k2: str, k3: str) -> list:
            v1, v2, v3 = src.get(k1), src.get(k2), src.get(k3)
            return [
                _render_m_color(a, v1, k1) if v1 is not None else None,
                _render_m_color(a, v2, k2) if v2 is not None else None,
                _render_m_color(a, v3, k3) if v3 is not None else None,
            ]

        def _disp(a):
            cur = current_lap.get(a)
            bl  = seg_best.get(a)
            if cur is not None:
                return (cur.get("s1"), cur.get("s2"), cur.get("s3"),
                        cur.get("s1Bars", list(_F)), cur.get("s2Bars", list(_F)), cur.get("s3Bars", list(_F)),
                        cur.get("inProgress", False))
            if bl is not None:
                return None, None, None, list(_T), list(_T), list(_T), False
            return None, None, None, list(_F), list(_F), list(_F), False

        sorted_abbrs = sorted(seg_best, key=lambda a: seg_best[a]["lapTimeSec"])
        p1_time = seg_best[sorted_abbrs[0]]["lapTimeSec"] if sorted_abbrs else None

        def _driver_row(a: str, pos: int | None, bl: dict | None) -> dict:
            ds1, ds2, ds3, db1, db2, db3, in_prog = _disp(a)
            cur = current_lap.get(a)
            compound = (cur or bl or {}).get("compound", "UNKNOWN")
            tire_age = (cur or bl or {}).get("tireAge", 0)
            info = driver_info.get(a, {"fullName": a, "teamName": "", "teamColor": "#ffffff", "driverNumber": "0"})
            gap = ((bl["lapTimeSec"] - p1_time)
                   if (bl and p1_time is not None and pos is not None and pos > 0) else None)
            s1c = _render_s_color(a, ds1, "s1") if ds1 is not None else None
            s2c = _render_s_color(a, ds2, "s2") if ds2 is not None else None
            s3c = _render_s_color(a, ds3, "s3") if ds3 is not None else None
            src = cur or bl or {}
            s1bc = _bc(a, src, "s1m1", "s1m2", "s1m3")
            s2bc = _bc(a, src, "s2m1", "s2m2", "s2m3")
            s3bc = _bc(a, src, "s3m1", "s3m2", "s3m3")
            sh = sector_hist[seg].get(a, {})
            best_s1 = min(sh["s1"]) if sh.get("s1") else None
            best_s2 = min(sh["s2"]) if sh.get("s2") else None
            best_s3 = min(sh["s3"]) if sh.get("s3") else None
            if cur and in_prog:
                track_status = "PITOUT" if cur.get("isPitOut") else "TRACK"
            else:
                track_status = "PIT"
            return {
                "position":     pos + 1 if pos is not None else None,
                "abbreviation": a,
                "fullName":     info["fullName"],
                "teamName":     info["teamName"],
                "teamColor":    info["teamColor"],
                "driverNumber": info["driverNumber"],
                "bestLapSec":   round(bl["lapTimeSec"], 3) if bl else None,
                "bestLapStr":   _lapstr(bl["lapTimeSec"]) if bl else None,
                "s1": round(ds1, 3) if ds1 is not None else None,
                "s2": round(ds2, 3) if ds2 is not None else None,
                "s3": round(ds3, 3) if ds3 is not None else None,
                "bestS1": round(best_s1, 3) if best_s1 is not None else None,
                "bestS2": round(best_s2, 3) if best_s2 is not None else None,
                "bestS3": round(best_s3, 3) if best_s3 is not None else None,
                "s1Color": s1c, "s2Color": s2c, "s3Color": s3c,
                "s1Bars": db1, "s2Bars": db2, "s3Bars": db3,
                "s1BarColors": s1bc, "s2BarColors": s2bc, "s3BarColors": s3bc,
                "compound":     compound,
                "tireAge":      tire_age,
                "gap":          round(gap, 3) if gap is not None else None,
                "gapStr":       f"+{gap:.3f}" if gap is not None else None,
                "inProgress":    in_prog,
                "trackStatus":   track_status,
                "lastLapSec":    round(last_lap[seg][a], 3) if a in last_lap[seg] else None,
                "lastLapStr":    _lapstr(last_lap[seg][a]) if a in last_lap[seg] else None,
                "justImproved":  (just_improved and a == ev_abbr and ev_type == "full"),
            }

        drivers_out = [_driver_row(a, pos, seg_best[a])
                       for pos, a in enumerate(sorted_abbrs)]
        has_time = set(sorted_abbrs)
        drivers_out += [_driver_row(a, None, None)
                        for a in sorted(driver_info) if a not in has_time]

        return json.dumps({
            "type": "timing_update",
            "segment": seg,
            "segmentIndex": segment_names.index(seg),
            "sessionTime": round(session_time, 1),
            "drivers": drivers_out,
        })

    try:
        for event in events_list:
            abbr         = event["abbr"]
            seg          = event["seg"]
            ev_type      = event["ev"]
            session_time = event["sessionTime"]
            compound     = event["compound"]
            tire_age     = event["tireAge"]
            s1, s2, s3   = event["s1"], event["s2"], event["s3"]
            ev_s1m1, ev_s1m2, ev_s1m3 = event.get("s1m1"), event.get("s1m2"), event.get("s1m3")
            ev_s2m1, ev_s2m2, ev_s2m3 = event.get("s2m1"), event.get("s2m2"), event.get("s2m3")
            ev_s3m1, ev_s3m2, ev_s3m3 = event.get("s3m1"), event.get("s3m2"), event.get("s3m3")
            ev_is_pit_out = event.get("isPitOut", False)

            # Pace the replay: sleep proportional to elapsed real time, capped at 90 s
            if prev_time is not None:
                gap_real = max(0.0, session_time - prev_time)
                gap_sim  = min(gap_real, 90.0) / max(1.0, speed)
                if gap_sim > 0.05:
                    await asyncio.sleep(gap_sim)
            prev_time = session_time

            # Segment transition
            if seg != current_seg:
                current_lap.clear()
                await websocket.send_text(json.dumps({
                    "type": "segment_change",
                    "segment": seg,
                    "segmentIndex": segment_names.index(seg),
                }))
                current_seg = seg

            # Update in-progress bar state per event type
            just_improved = False

            if ev_type == "s1m1":
                # Bar 1 of sector 1 just completed — record its time immediately
                if ev_s1m1 is not None:
                    _upd_mini(seg, abbr, "s1m1", ev_s1m1)
                current_lap[abbr] = {
                    "s1": None, "s2": None, "s3": None,
                    "s1m1": ev_s1m1, "s1m2": None, "s1m3": None,
                    "s2m1": None, "s2m2": None, "s2m3": None,
                    "s3m1": None, "s3m2": None, "s3m3": None,
                    "s1Bars": [True, False, False],
                    "s2Bars": list(_F), "s3Bars": list(_F),
                    "compound": compound, "tireAge": tire_age,
                    "isPitOut": ev_is_pit_out, "inProgress": True,
                }
            elif ev_type == "s1m2":
                _ensure(abbr, compound, tire_age)
                if ev_s1m2 is not None:
                    _upd_mini(seg, abbr, "s1m2", ev_s1m2)
                current_lap[abbr]["s1m2"] = ev_s1m2
                current_lap[abbr]["s1Bars"] = [True, True, False]
            elif ev_type == "s1":
                _ensure(abbr, compound, tire_age)
                if s1 is not None:
                    sector_hist[seg].setdefault(abbr, {"s1": [], "s2": [], "s3": []})["s1"].append(s1)
                    if overall_best[seg]["s1"] is None or s1 < overall_best[seg]["s1"]:
                        overall_best[seg]["s1"] = s1
                    m1, m2, m3 = ev_s1m1, ev_s1m2, ev_s1m3
                    # s1m1 and s1m2 already recorded at their events; only record bar 3 now
                    if m3 is not None:
                        _upd_mini(seg, abbr, "s1m3", m3)
                    current_lap[abbr].update({
                        "s1": s1, "s1m1": m1, "s1m2": m2, "s1m3": m3,
                        "s1Bars": list(_T), "s2Bars": list(_F),
                        "compound": compound, "tireAge": tire_age,
                    })
                else:
                    current_lap[abbr].update({
                        "s1": s1, "s1Bars": list(_T), "s2Bars": list(_F),
                        "compound": compound, "tireAge": tire_age,
                    })
            elif ev_type == "s2m1":
                _ensure(abbr, compound, tire_age)
                if ev_s2m1 is not None:
                    _upd_mini(seg, abbr, "s2m1", ev_s2m1)
                current_lap[abbr]["s2m1"] = ev_s2m1
                current_lap[abbr]["s2Bars"] = [True, False, False]
            elif ev_type == "s2m2":
                _ensure(abbr, compound, tire_age)
                if ev_s2m2 is not None:
                    _upd_mini(seg, abbr, "s2m2", ev_s2m2)
                current_lap[abbr]["s2m2"] = ev_s2m2
                current_lap[abbr]["s2Bars"] = [True, True, False]
            elif ev_type == "s2":
                _ensure(abbr, compound, tire_age)
                if s2 is not None:
                    sector_hist[seg].setdefault(abbr, {"s1": [], "s2": [], "s3": []})["s2"].append(s2)
                    if overall_best[seg]["s2"] is None or s2 < overall_best[seg]["s2"]:
                        overall_best[seg]["s2"] = s2
                    m1, m2, m3 = ev_s2m1, ev_s2m2, ev_s2m3
                    # s2m1 and s2m2 already recorded at their events; only record bar 3 now
                    if m3 is not None:
                        _upd_mini(seg, abbr, "s2m3", m3)
                    current_lap[abbr].update({
                        "s2": s2, "s2m1": m1, "s2m2": m2, "s2m3": m3,
                        "s2Bars": list(_T), "s3Bars": list(_F),
                    })
                else:
                    current_lap[abbr].update({"s2": s2, "s2Bars": list(_T), "s3Bars": list(_F)})
            elif ev_type == "s3m1":
                _ensure(abbr, compound, tire_age)
                if ev_s3m1 is not None:
                    _upd_mini(seg, abbr, "s3m1", ev_s3m1)
                current_lap[abbr]["s3m1"] = ev_s3m1
                current_lap[abbr]["s3Bars"] = [True, False, False]
            elif ev_type == "s3m2":
                _ensure(abbr, compound, tire_age)
                if ev_s3m2 is not None:
                    _upd_mini(seg, abbr, "s3m2", ev_s3m2)
                current_lap[abbr]["s3m2"] = ev_s3m2
                current_lap[abbr]["s3Bars"] = [True, True, False]
            elif ev_type == "full":
                lap_sec = event["lapSec"]
                if s3 is not None:
                    sector_hist[seg].setdefault(abbr, {"s1": [], "s2": [], "s3": []})["s3"].append(s3)
                    if overall_best[seg]["s3"] is None or s3 < overall_best[seg]["s3"]:
                        overall_best[seg]["s3"] = s3
                    # s3m1 and s3m2 already recorded at their events; only record bar 3 now
                    if ev_s3m3 is not None:
                        _upd_mini(seg, abbr, "s3m3", ev_s3m3)
                prev = current_lap.get(abbr, {})
                s1m1 = prev.get("s1m1") if s1 is not None else None
                s1m2 = prev.get("s1m2") if s1 is not None else None
                s1m3 = prev.get("s1m3") if s1 is not None else None
                s2m1 = prev.get("s2m1") if s2 is not None else None
                s2m2 = prev.get("s2m2") if s2 is not None else None
                s2m3 = prev.get("s2m3") if s2 is not None else None
                current_lap[abbr] = {
                    "s1": s1, "s2": s2, "s3": s3,
                    "s1m1": s1m1, "s1m2": s1m2, "s1m3": s1m3,
                    "s2m1": s2m1, "s2m2": s2m2, "s2m3": s2m3,
                    "s3m1": ev_s3m1, "s3m2": ev_s3m2, "s3m3": ev_s3m3,
                    "s1Bars": list(_T) if s1 is not None else list(_F),
                    "s2Bars": list(_T) if s2 is not None else list(_F),
                    "s3Bars": list(_T) if s3 is not None else list(_F),
                    "compound": compound, "tireAge": tire_age, "inProgress": False,
                }
                old_best = best[seg].get(abbr, {}).get("lapTimeSec", float("inf"))
                if lap_sec < old_best:
                    best[seg][abbr] = {
                        "lapTimeSec": lap_sec, "s1": s1, "s2": s2, "s3": s3,
                        "s1m1": s1m1, "s1m2": s1m2, "s1m3": s1m3,
                        "s2m1": s2m1, "s2m2": s2m2, "s2m3": s2m3,
                        "s3m1": ev_s3m1, "s3m2": ev_s3m2, "s3m3": ev_s3m3,
                        "compound": compound, "tireAge": tire_age,
                    }
                    just_improved = True
                last_lap[seg][abbr] = lap_sec

            await websocket.send_text(
                _build_snapshot(seg, abbr, ev_type, just_improved, session_time)
            )

        await websocket.send_text(json.dumps({"type": "session_end"}))

    except WebSocketDisconnect:
        pass


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
            try:
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
