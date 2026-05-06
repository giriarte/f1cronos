import { useState, useEffect } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { fetchSessions, fetchResults } from '../api/f1Api'
import './RaceDetailPage.css'

function sessionType(name) {
  if (!name) return 'race'
  const n = name.toLowerCase()
  if (n.includes('practice')) return 'practice'
  if (n.includes('shootout') || (n.includes('qualifying') && n.includes('sprint'))) return 'qualifying'
  if (n.includes('qualifying')) return 'qualifying'
  if (n.includes('sprint')) return 'sprint'
  return 'race'
}

function ResultsTable({ results, session }) {
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
            <th className="col-driver">Driver</th>
            <th className="col-team">Team</th>
            {isQuali && <th className="col-time">Q1</th>}
            {isQuali && <th className="col-time">Q2</th>}
            {isQuali && <th className="col-time">Q3</th>}
            {!isQuali && <th className="col-time">Time / Gap</th>}
            {isRace && <th className="col-grid">Grid</th>}
            {isRace && <th className="col-pts">PTS</th>}
            {!isQuali && <th className="col-status">Status</th>}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={r.driverNumber} className={i % 2 === 0 ? 'row-even' : ''}>
              <td className="col-pos">{r.classifiedPosition || r.position || '—'}</td>
              <td className="col-no">{r.driverNumber}</td>
              <td className="col-driver">
                <span className="driver-abbr">{r.abbreviation}</span>
                <span className="driver-name">{r.fullName}</span>
              </td>
              <td className="col-team">
                <span
                  className="team-dot"
                  style={{ background: r.teamColor }}
                />
                {r.teamName}
              </td>
              {isQuali && <td className="col-time mono">{r.q1 ?? '—'}</td>}
              {isQuali && <td className="col-time mono">{r.q2 ?? '—'}</td>}
              {isQuali && <td className="col-time mono">{r.q3 ?? '—'}</td>}
              {!isQuali && <td className="col-time mono">{r.time ?? '—'}</td>}
              {isRace && <td className="col-grid">{r.gridPosition ?? '—'}</td>}
              {isRace && <td className="col-pts">{r.points > 0 ? r.points : ''}</td>}
              {!isQuali && <td className="col-status">{r.status}</td>}
            </tr>
          ))}
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
          <ResultsTable results={results} session={selectedSession} />
        )}
      </div>
    </div>
  )
}
