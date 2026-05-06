import { useState, useEffect } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { fetchSessions, fetchResults, fetchQualiSectors } from '../api/f1Api'
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

function ResultsTable({ results, session, sectors }) {
  const type = sessionType(session)
  const isQuali = type === 'qualifying'
  const isRace = type === 'race' || type === 'sprint'

  return (
    <div className="results-wrapper">
      <table className="results-table">
        <thead>
          <tr>
            <th className="col-pos">POS</th>
            <th className="col-no">NO</th>
            <th className="col-team-icon"></th>
            <th className="col-driver">Driver</th>
            {isQuali && <th className="col-q">Q1</th>}
            {isQuali && <th className="col-q">Q2</th>}
            {isQuali && <th className="col-q">Q3</th>}
            {!isQuali && <th className="col-time">Time / Gap</th>}
            {isRace && <th className="col-grid">Grid</th>}
            {isRace && <th className="col-pts">PTS</th>}
            {!isQuali && <th className="col-status">Status</th>}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const driverSectors = sectors[r.abbreviation]
            return (
              <tr key={r.driverNumber} className={i % 2 === 0 ? 'row-even' : ''}>
                <td className="col-pos">{r.classifiedPosition || r.position || '—'}</td>
                <td className="col-no">{r.driverNumber}</td>
                <td className="col-team-icon">
                  <span className="team-bar" style={{ background: r.teamColor }} />
                </td>
                <td className="col-driver">
                  <span className="driver-abbr">{r.abbreviation}</span>
                  <span className="driver-name">{r.fullName}</span>
                </td>
                {isQuali && <QCell lapTime={r.q1} seg={driverSectors?.q1} />}
                {isQuali && <QCell lapTime={r.q2} seg={driverSectors?.q2} />}
                {isQuali && <QCell lapTime={r.q3} seg={driverSectors?.q3} />}
                {!isQuali && <td className="col-time mono">{r.time ?? '—'}</td>}
                {isRace && <td className="col-grid">{r.gridPosition ?? '—'}</td>}
                {isRace && <td className="col-pts">{r.points > 0 ? r.points : ''}</td>}
                {!isQuali && <td className="col-status">{r.status}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
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

  useEffect(() => {
    setLoadingSessions(true)
    fetchSessions(year, round)
      .then((data) => {
        setSessions(data)
        setSelectedSession(data.at(-1)?.name ?? null)
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

    fetchResults(year, round, selectedSession)
      .then((data) => { if (!cancelled) setResults(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoadingResults(false) })

    return () => { cancelled = true }
  }, [selectedSession, year, round])

  useEffect(() => {
    setSectors({})
    if (!selectedSession || sessionType(selectedSession) !== 'qualifying') return
    let cancelled = false
    fetchQualiSectors(year, round, selectedSession)
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
              {sessions.map((s) => (
                <option key={s.index} value={s.name}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="detail-body">
        {loadingResults && <p className="status-message">Loading results…</p>}
        {error && <p className="status-message error">Error: {error}</p>}
        {!loadingResults && !error && results.length > 0 && (
          <ResultsTable results={results} session={selectedSession} sectors={sectors} />
        )}
      </div>
    </div>
  )
}
