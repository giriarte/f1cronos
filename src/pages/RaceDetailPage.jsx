import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { fetchSessions, fetchResults, fetchQualiSectors, fetchLaps, fetchDrivers } from '../api/f1Api'
import './RaceDetailPage.css'

const FALLBACK_COLORS = [
  '#e10600', '#0090ff', '#39b54a', '#ffd700', '#ff8700',
  '#b440fb', '#00d2be', '#f596c8', '#006f62', '#52e252',
]

function fmtLapTime(secs) {
  if (secs == null || isNaN(secs)) return '—'
  const m = Math.floor(secs / 60)
  const s = (secs % 60).toFixed(3).padStart(6, '0')
  return `${m}:${s}`
}

function PracticeChartTooltip({ active, payload, label, colorMap }) {
  if (!active || !payload?.length) return null
  return (
    <div className="plc-chart-tooltip">
      <p className="plc-tooltip-lap">Lap {label}</p>
      {payload.map(entry => (
        <div key={entry.dataKey} className="plc-tooltip-row">
          <span className="plc-tooltip-dot" style={{ background: entry.color }} />
          <span className="plc-tooltip-abbr">{entry.dataKey}</span>
          <span className="plc-tooltip-time">{fmtLapTime(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

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

function PracticeLapComparison({ year, round, sessionName, race }) {
  const [allDrivers, setAllDrivers] = useState([])
  const [selectedDrivers, setSelectedDrivers] = useState([])
  const [lapsData, setLapsData] = useState({})
  const [loadingDrivers, setLoadingDrivers] = useState(true)
  const [loadingLaps, setLoadingLaps] = useState({})
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const loadedSet = useRef(new Set())

  useEffect(() => {
    setAllDrivers([])
    setSelectedDrivers([])
    setLapsData({})
    loadedSet.current = new Set()
    setLoadingDrivers(true)
    fetchDrivers(year, round, sessionName, race?.date)
      .then(setAllDrivers)
      .catch(() => setAllDrivers([]))
      .finally(() => setLoadingDrivers(false))
  }, [year, round, sessionName])

  useEffect(() => {
    function onMouseDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  async function loadDriverLaps(abbr) {
    if (loadedSet.current.has(abbr)) return
    loadedSet.current.add(abbr)
    setLoadingLaps(prev => ({ ...prev, [abbr]: true }))
    try {
      const data = await fetchLaps(year, round, sessionName, abbr, race?.date)
      setLapsData(prev => ({ ...prev, [abbr]: data }))
    } catch {
      setLapsData(prev => ({ ...prev, [abbr]: [] }))
    }
    setLoadingLaps(prev => ({ ...prev, [abbr]: false }))
  }

  function toggleDriver(abbr) {
    if (selectedDrivers.includes(abbr)) {
      setSelectedDrivers(prev => prev.filter(d => d !== abbr))
    } else if (selectedDrivers.length < 10) {
      setSelectedDrivers(prev => [...prev, abbr])
      loadDriverLaps(abbr)
    }
  }

  const colorMap = Object.fromEntries(
    allDrivers.map((d, i) => [d.abbreviation, d.teamColor || FALLBACK_COLORS[i % FALLBACK_COLORS.length]])
  )

  const topLaps = {}
  selectedDrivers.forEach(abbr => {
    topLaps[abbr] = (lapsData[abbr] || [])
      .filter(l => l.LapTime != null && !isNaN(l.LapTime))
      .sort((a, b) => a.LapTime - b.LapTime)
      .slice(0, 20)
  })

  const maxRows = selectedDrivers.length === 0
    ? 0
    : Math.max(...selectedDrivers.map(a => topLaps[a]?.length || 0))

  const chartData = useMemo(() => {
    const driverAvg = {}
    selectedDrivers.forEach(abbr => {
      const times = (lapsData[abbr] || []).map(l => l.LapTime).filter(t => t != null && !isNaN(t))
      if (times.length > 0) driverAvg[abbr] = times.reduce((a, b) => a + b, 0) / times.length
    })
    const lapNums = new Set()
    selectedDrivers.forEach(abbr => {
      ;(lapsData[abbr] || []).forEach(l => { if (l.LapNumber != null) lapNums.add(l.LapNumber) })
    })
    return Array.from(lapNums).sort((a, b) => a - b).map(lapNum => {
      const point = { lap: lapNum }
      selectedDrivers.forEach(abbr => {
        const lap = (lapsData[abbr] || []).find(l => l.LapNumber === lapNum)
        if (lap && lap.LapTime != null && !isNaN(lap.LapTime)) {
          const avg = driverAvg[abbr]
          if (avg == null || lap.LapTime <= avg * 1.06) point[abbr] = lap.LapTime
        }
      })
      return point
    })
  }, [selectedDrivers, lapsData])

  const atMax = selectedDrivers.length >= 10
  const btnLabel = selectedDrivers.length === 0
    ? 'Select drivers'
    : `${selectedDrivers.length} / 10 drivers`

  return (
    <div className="practice-lap-section">
      <div className="plc-header">
        <h2 className="plc-title">Lap Comparison</h2>
        <div className="plc-controls" ref={dropdownRef}>
          <button className="plc-select-btn" onClick={() => setDropdownOpen(o => !o)}>
            {btnLabel}
            <span className="plc-chevron">{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div className="plc-dropdown">
              {atMax && <div className="plc-dropdown-hint">10 driver limit reached</div>}
              {loadingDrivers ? (
                <div className="plc-dropdown-msg">Loading drivers…</div>
              ) : allDrivers.length === 0 ? (
                <div className="plc-dropdown-msg">No drivers found</div>
              ) : (
                allDrivers.map(d => {
                  const checked = selectedDrivers.includes(d.abbreviation)
                  const disabled = atMax && !checked
                  return (
                    <label
                      key={d.abbreviation}
                      className={`plc-dropdown-item${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleDriver(d.abbreviation)}
                      />
                      <span className="plc-dot" style={{ background: colorMap[d.abbreviation] }} />
                      <span className="plc-abbr">{d.abbreviation}</span>
                      <span className="plc-dname">{d.full_name}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {selectedDrivers.length === 0 ? (
        <p className="status-message">Select drivers above to compare their top 20 fastest laps.</p>
      ) : (
        <>
          <div className="plc-table-wrap">
            <table className="plc-table">
              <thead>
                <tr>
                  <th className="plc-th-rank">#</th>
                  {selectedDrivers.map(abbr => (
                    <th key={abbr} className="plc-th-driver">
                      <span className="plc-th-bar" style={{ background: colorMap[abbr] }} />
                      {abbr}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRows }, (_, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'row-even' : ''}>
                    <td className="plc-td-rank">{i + 1}</td>
                    {selectedDrivers.map(abbr => {
                      if (loadingLaps[abbr]) {
                        return <td key={abbr} className="plc-td-time"><span className="plc-muted">…</span></td>
                      }
                      const lap = topLaps[abbr]?.[i]
                      return (
                        <td key={abbr} className="plc-td-time">
                          {lap ? (
                            <>
                              <span className="plc-time">{fmtLapTime(lap.LapTime)}</span>
                              <span className="plc-lapnum">L{lap.LapNumber}</span>
                            </>
                          ) : (
                            <span className="plc-muted">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chartData.length > 0 && (
            <div className="plc-chart-wrap">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData} margin={{ top: 8, right: 32, bottom: 28, left: 72 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="lap"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickLine={false}
                    label={{ value: 'Lap', position: 'insideBottom', offset: -14, fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={fmtLapTime}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickLine={false}
                    domain={['auto', 'auto']}
                    width={72}
                  />
                  <Tooltip content={<PracticeChartTooltip colorMap={colorMap} />} />
                  <Legend
                    wrapperStyle={{ paddingTop: '12px' }}
                    formatter={value => (
                      <span style={{ color: colorMap[value] || 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
                        {value}
                      </span>
                    )}
                  />
                  {selectedDrivers.map(abbr => (
                    <Line
                      key={abbr}
                      type="monotone"
                      dataKey={abbr}
                      stroke={colorMap[abbr]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function RaceDetailPage() {
  const { year, round } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const race = state?.race

  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [results, setResults] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingResults, setLoadingResults] = useState(false)
  const [error, setError] = useState(null)
  const [sectors, setSectors] = useState({})

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
              onChange={(e) => {
                if (e.target.value === '__predictions__') {
                  navigate(`/predictions/${year}/${round}`)
                } else {
                  setSelectedSession(e.target.value)
                }
              }}
            >
              {sessions.map((s) => {
                const isUpcoming = s.date && new Date(s.date) >= new Date()
                return (
                  <option key={s.index} value={s.name} disabled={isUpcoming}>
                    {s.name}{isUpcoming ? ' — upcoming' : ''}
                  </option>
                )
              })}
              {Number(year) >= 2026 && (
                <option value="__predictions__">AI Predictions</option>
              )}
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
                {sessionType(selectedSession) === 'practice' && (
                  <PracticeLapComparison year={year} round={round} sessionName={selectedSession} race={race} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
