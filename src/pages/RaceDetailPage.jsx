import { useState, useEffect } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { fetchSessions, fetchResults, fetchQualiSectors, fetchStandings } from '../api/f1Api'
import './RaceDetailPage.css'

const SECTOR_COLORS = {
  purple: '#B440FB',
  green:  '#39B54A',
  yellow: '#FFD700',
  red:    '#9d9b9b',
}

function QCell({ lapTime, seg }) {
  if (!lapTime) return <td className="col-q mono">—</td>
  if (!seg) return <td className="col-q mono">{lapTime}</td>

  const hex = (key) => SECTOR_COLORS[key] ?? '#555'
  const fmtSec = (s) => s != null ? s.toFixed(3) : '—'

  return (
    <td className="col-q">
      <div className="q-inner">
        <span className="q-laptime">{lapTime}</span>
        <div className="q-grid">
          {[['s1', 's1Color'], ['s2', 's2Color'], ['s3', 's3Color']].map(([sk, ck]) => {
            const c = hex(seg[ck])
            return (
              <div key={sk} className="q-sector-col">
                <span className="q-sector-time" style={{ color: c }}>{fmtSec(seg[sk])}</span>
                <div className="q-micros">
                  <span className="q-micro" style={{ background: c }} />
                  <span className="q-micro" style={{ background: c }} />
                  <span className="q-micro" style={{ background: c }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </td>
  )
}

function sessionType(name) {
  if (!name) return 'race'
  const n = name.toLowerCase()
  if (n.includes('practice')) return 'practice'
  if (n.includes('shootout') || (n.includes('qualifying') && n.includes('sprint'))) return 'qualifying'
  if (n.includes('qualifying')) return 'qualifying'
  if (n.includes('sprint')) return 'sprint'
  return 'race'
}

function DriverCard({ r, driverSectors, isQuali, isRace, detailsTo, detailsState }) {
  const pos = r.classifiedPosition || r.position || '—'
  const delta = isRace ? posDelta(r) : null
  const deltaLabel = delta == null ? null : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : null
  const deltaCls   = delta > 0 ? 'pos-gain' : delta < 0 ? 'pos-loss' : 'pos-same'
  return (
    <div className="driver-card">
      <div className="card-header">
        <span className="card-pos">{pos}</span>
        {isRace && deltaLabel && (
          <span className={`card-delta ${deltaCls}`}>{deltaLabel}</span>
        )}
        <span className="card-team-bar" style={{ background: r.teamColor }} />
        <div className="card-driver-info">
          <span className="card-abbr">{r.abbreviation}</span>
          <span className="card-name">{r.fullName}</span>
        </div>
        {isRace && r.points > 0 && (
          <span className="pts-pill">{r.points} pts</span>
        )}
      </div>

      {isQuali ? (
        <div className="card-q-rows">
          {[['Q1', r.q1, driverSectors?.q1], ['Q2', r.q2, driverSectors?.q2], ['Q3', r.q3, driverSectors?.q3]].map(
            ([label, time, seg]) => time && (
              <div key={label} className="card-q-row">
                <span className="card-q-label">{label}</span>
                <span className="card-q-time">{time}</span>
                {seg && (
                  <div className="card-sectors">
                    {['s1', 's2', 's3'].map((s) => {
                      const c = SECTOR_COLORS[seg[`${s}Color`]] ?? '#555'
                      const t = seg[s] != null ? seg[s].toFixed(3) : '—'
                      return (
                        <div key={s} className="card-sector-group">
                          <div className="card-micro-row">
                            <span className="card-micro" style={{ background: c }} />
                            <span className="card-micro" style={{ background: c }} />
                            <span className="card-micro" style={{ background: c }} />
                          </div>
                          <span className="card-sector-time" style={{ color: c }}>{t}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      ) : (
        <div className="card-result-row">
          <span className="card-time">{r.time ?? '—'}</span>
          {isRace && <span className="card-grid">Grid {r.gridPosition ?? '—'}</span>}
          <StatusBadge status={r.status} />
          {isRace && detailsTo && (
            <Link to={detailsTo} state={detailsState} className="card-details-btn">Laps</Link>
          )}
        </div>
      )}
    </div>
  )
}

function MobileResults({ results, session, sectors, year, round, race }) {
  const type = sessionType(session)
  const isQuali = type === 'qualifying'
  const isRace = type === 'race' || type === 'sprint'
  const driverColorMap = isRace
    ? Object.fromEntries(results.map(r => [r.abbreviation, r.teamColor]))
    : {}
  return (
    <div className="results-cards">
      {results.map((r) => (
        <DriverCard
          key={r.driverNumber}
          r={r}
          driverSectors={sectors[r.abbreviation]}
          isQuali={isQuali}
          isRace={isRace}
          detailsTo={isRace ? `/race/${year}/${round}/laps` : undefined}
          detailsState={isRace ? { race, initialDriver: r.abbreviation, sessionName: session, driverColorMap } : undefined}
        />
      ))}
    </div>
  )
}

function posDelta(r) {
  const finish = parseInt(r.classifiedPosition, 10)
  const grid   = parseInt(r.gridPosition, 10)
  if (isNaN(finish) || isNaN(grid) || grid <= 0) return null
  return grid - finish  // positive = gained positions
}

function StatusBadge({ status }) {
  if (!status || status === 'Finished') return null
  const isLapped = /^\+\d+ Lap/.test(status)
  const isDns    = status === 'DNS' || status === 'Withdrawn'
  const cls      = isDns ? 'status-dns' : isLapped ? 'status-lapped' : 'status-dnf'
  return <span className={`race-status-badge ${cls}`}>{status}</span>
}

function ResultsTable({ results, session, sectors, year, round, race }) {
  const type = sessionType(session)
  const isQuali = type === 'qualifying'
  const isRace  = type === 'race' || type === 'sprint'
  const driverColorMap = isRace
    ? Object.fromEntries(results.map(r => [r.abbreviation, r.teamColor]))
    : {}

  return (
    <div className="results-wrapper">
      <table className="results-table">
        <thead>
          <tr>
            <th className="col-pos">POS</th>
            {isRace && <th className="col-delta">△</th>}
            <th className="col-no">NO</th>
            <th className="col-team-icon" />
            <th className="col-driver">Driver</th>
            {isRace && <th className="col-team-name">Team</th>}
            {isQuali && <th className="col-q">Q1</th>}
            {isQuali && <th className="col-q">Q2</th>}
            {isQuali && <th className="col-q">Q3</th>}
            {!isQuali && <th className="col-time">Time / Gap</th>}
            {isRace && <th className="col-grid">Grid</th>}
            {isRace && <th className="col-pts">PTS</th>}
            {!isQuali && <th className="col-status">Status</th>}
            {isRace && <th className="col-details" />}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const driverSectors = sectors[r.abbreviation]
            const delta = isRace ? posDelta(r) : null
            const deltaLabel = delta == null ? '—' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : '—'
            const deltaCls   = delta > 0 ? 'pos-gain' : delta < 0 ? 'pos-loss' : 'pos-same'
            return (
              <tr key={r.driverNumber} className={i % 2 === 0 ? 'row-even' : ''}>
                <td className="col-pos">{r.classifiedPosition || r.position || '—'}</td>
                {isRace && <td className={`col-delta ${deltaCls}`}>{deltaLabel}</td>}
                <td className="col-no">{r.driverNumber}</td>
                <td className="col-team-icon">
                  <span className="team-bar" style={{ background: r.teamColor }} />
                </td>
                <td className="col-driver">
                  <span className="driver-abbr">{r.abbreviation}</span>
                  <span className="driver-name">{r.fullName}</span>
                </td>
                {isRace && <td className="col-team-name">{r.teamName}</td>}
                {isQuali && <QCell lapTime={r.q1} seg={driverSectors?.q1} />}
                {isQuali && <QCell lapTime={r.q2} seg={driverSectors?.q2} />}
                {isQuali && <QCell lapTime={r.q3} seg={driverSectors?.q3} />}
                {!isQuali && <td className="col-time mono">{r.time ?? '—'}</td>}
                {isRace && <td className="col-grid">{r.gridPosition ?? '—'}</td>}
                {isRace && (
                  <td className="col-pts">
                    {r.points > 0 && <span className="pts-pill">{r.points}</span>}
                  </td>
                )}
                {!isQuali && (
                  <td className="col-status">
                    <StatusBadge status={r.status} />
                  </td>
                )}
                {isRace && (
                  <td className="col-details">
                    <Link
                      to={`/race/${year}/${round}/laps`}
                      state={{ race, initialDriver: r.abbreviation, sessionName: session, driverColorMap }}
                      className="details-btn"
                    >
                      Laps
                    </Link>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StandingsTable({ standings, year, round }) {
  if (!standings.length) return null
  return (
    <div className="standings-section">
      <h2 className="standings-title">Driver Championship Standings</h2>
      <div className="results-wrapper">
        <table className="results-table">
          <thead>
            <tr>
              <th className="col-pos">POS</th>
              <th className="col-team-icon"></th>
              <th className="col-driver">Driver</th>
              <th className="col-team-name">Team</th>
              <th className="col-pts standings-pts">PTS</th>
              <th className="col-details"></th>
            </tr>
          </thead>
          <tbody>
            {standings.map((d, i) => (
              <tr key={d.abbreviation} className={i % 2 === 0 ? 'row-even' : ''}>
                <td className="col-pos">{d.position}</td>
                <td className="col-team-icon">
                  <span className="team-bar" style={{ background: d.teamColor }} />
                </td>
                <td className="col-driver">
                  <span className="driver-abbr">{d.abbreviation}</span>
                  <span className="driver-name">{d.fullName}</span>
                </td>
                <td className="col-team-name">{d.teamName}</td>
                <td className="col-pts standings-pts">{d.points}</td>
                <td className="col-details">
                  <Link
                    to={`/championship/${year}`}
                    state={{ initialDriver: d.abbreviation, standings, round }}
                    className="details-btn"
                  >
                    Stats
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RaceDetailPage() {
  const { year, round } = useParams()
  const { state } = useLocation()
  const race = state?.race

  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [results, setResults] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingResults, setLoadingResults] = useState(false)
  const [error, setError] = useState(null)
  const [sectors, setSectors] = useState({})
  const [standings, setStandings] = useState([])
  const [loadingStandings, setLoadingStandings] = useState(false)

  useEffect(() => {
    if (race?.status === 'cancelled') {
      setLoadingSessions(false)
      return
    }
    setLoadingSessions(true)
    fetchSessions(year, round, race?.date)
      .then((data) => {
        setSessions(data)
        const now = new Date()
        const completed = data.filter(s => s.date && new Date(s.date) < now)
        const toSelect = (completed.length > 0 ? completed : data).at(-1)
        setSelectedSession(toSelect?.name ?? null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSessions(false))
  }, [year, round])

  useEffect(() => {
    if (!selectedSession) return
    let cancelled = false
    setLoadingResults(true)
    setError(null)
    setResults([])

    fetchResults(year, round, selectedSession, race?.date)
      .then((data) => { if (!cancelled) setResults(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoadingResults(false) })

    return () => { cancelled = true }
  }, [selectedSession, year, round])

  useEffect(() => {
    const type = sessionType(selectedSession)
    if (type !== 'race' && type !== 'sprint') {
      setStandings([])
      return
    }
    let cancelled = false
    setLoadingStandings(true)
    fetchStandings(year, round, race?.date)
      .then((data) => { if (!cancelled) setStandings(data) })
      .catch(() => { if (!cancelled) setStandings([]) })
      .finally(() => { if (!cancelled) setLoadingStandings(false) })
    return () => { cancelled = true }
  }, [selectedSession, year, round])

  useEffect(() => {
    setSectors({})
    if (!selectedSession || sessionType(selectedSession) !== 'qualifying') return
    let cancelled = false
    fetchQualiSectors(year, round, selectedSession, race?.date)
      .then((data) => {
        if (cancelled) return
        const map = {}
        data.forEach((d) => { map[d.abbreviation] = d })
        setSectors(map)
      })
      .catch(() => { if (!cancelled) setSectors({}) })
    return () => { cancelled = true }
  }, [selectedSession, year, round])

  const title = race ? race.name.replace(' Grand Prix', '') : `Round ${round}`

  return (
    <div className="detail-page">
      <div className="detail-header">
        <div className="detail-header-left">
          <Link to="/" className="back-btn">← Back</Link>
          <div className="detail-title">
            <span className="detail-round">Round {round} · {year}</span>
            <h1 className="detail-name">{title} Grand Prix</h1>
          </div>
        </div>

        <div className="detail-header-right">
          {loadingSessions ? (
            <span className="status-message">Loading…</span>
          ) : (
            <select
              className="session-select"
              value={selectedSession ?? ''}
              onChange={(e) => setSelectedSession(e.target.value)}
            >
              {sessions.map((s) => {
                const isUpcoming = s.date && new Date(s.date) >= new Date()
                return (
                  <option key={s.index} value={s.name} disabled={isUpcoming}>
                    {s.name}{isUpcoming ? ' — upcoming' : ''}
                  </option>
                )
              })}
            </select>
          )}
        </div>
      </div>

      <div className="detail-body">
        {race?.status === 'cancelled' ? (
          <p className="status-message cancelled-notice">This race was cancelled.</p>
        ) : (
          <>
            {loadingResults && <p className="status-message">Loading results…</p>}
            {error && <p className="status-message error">Error: {error}</p>}
            {!loadingResults && !error && results.length > 0 && (
              <>
                <ResultsTable results={results} session={selectedSession} sectors={sectors} year={year} round={round} race={race} />
                <MobileResults results={results} session={selectedSession} sectors={sectors} year={year} round={round} race={race} />
              </>
            )}
            {loadingStandings && <p className="status-message standings-loading">Loading standings…</p>}
            {!loadingStandings && standings.length > 0 && (
              <StandingsTable standings={standings} year={year} round={round} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
