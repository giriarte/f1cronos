import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { fetchLaps, fetchDrivers } from '../api/f1Api'
import './LapTimesPage.css'

function fmtLapTime(secs) {
  if (secs == null || isNaN(secs)) return '—'
  const m = Math.floor(secs / 60)
  const s = (secs % 60).toFixed(3).padStart(6, '0')
  return `${m}:${s}`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tooltip-lap">Lap {label}</p>
      {payload.map(entry => (
        <div key={entry.dataKey} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: entry.color }} />
          <span className="tooltip-abbr">{entry.dataKey}</span>
          <span className="tooltip-time">{fmtLapTime(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

const FALLBACK_COLORS = [
  '#e10600', '#0090ff', '#39b54a', '#ffd700', '#ff8700',
  '#b440fb', '#00d2be', '#f596c8', '#006f62', '#52e252',
]

export default function LapTimesPage() {
  const { year, round } = useParams()
  const { state } = useLocation()
  const { race, initialDriver, sessionName, driverColorMap = {} } = state || {}

  const [allDrivers, setAllDrivers] = useState([])
  const [selectedDrivers, setSelectedDrivers] = useState(initialDriver ? [initialDriver] : [])
  const [lapsData, setLapsData] = useState({})
  const [loadingLaps, setLoadingLaps] = useState({})
  const [loadingDrivers, setLoadingDrivers] = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const loadedSet = useRef(new Set())
  const colorMap = useRef({ ...driverColorMap })
  const fallbackIdx = useRef(0)

  function getColor(abbr) {
    if (!colorMap.current[abbr]) {
      colorMap.current[abbr] = FALLBACK_COLORS[fallbackIdx.current % FALLBACK_COLORS.length]
      fallbackIdx.current++
    }
    return colorMap.current[abbr]
  }

  async function loadDriverLaps(abbr) {
    if (loadedSet.current.has(abbr)) return
    loadedSet.current.add(abbr)
    setLoadingLaps(prev => ({ ...prev, [abbr]: true }))
    try {
      const data = await fetchLaps(year, round, sessionName, abbr)
      setLapsData(prev => ({ ...prev, [abbr]: data }))
    } catch {
      setLapsData(prev => ({ ...prev, [abbr]: [] }))
    }
    setLoadingLaps(prev => ({ ...prev, [abbr]: false }))
  }

  useEffect(() => {
    if (!sessionName) return
    fetchDrivers(year, round, sessionName)
      .then(data => setAllDrivers(data))
      .catch(() => setAllDrivers([]))
      .finally(() => setLoadingDrivers(false))
  }, [year, round, sessionName])

  useEffect(() => {
    if (initialDriver && sessionName) loadDriverLaps(initialDriver)
  }, [])

  function toggleDriver(abbr) {
    if (selectedDrivers.includes(abbr)) {
      setSelectedDrivers(prev => prev.filter(d => d !== abbr))
    } else {
      setSelectedDrivers(prev => [...prev, abbr])
      loadDriverLaps(abbr)
    }
  }

  useEffect(() => {
    function onMouseDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const chartData = useMemo(() => {
    const lapNums = new Set()
    selectedDrivers.forEach(abbr => {
      ;(lapsData[abbr] || []).forEach(lap => {
        if (lap.LapNumber != null) lapNums.add(lap.LapNumber)
      })
    })
    return Array.from(lapNums).sort((a, b) => a - b).map(lapNum => {
      const point = { lap: lapNum }
      selectedDrivers.forEach(abbr => {
        const lap = (lapsData[abbr] || []).find(l => l.LapNumber === lapNum)
        if (lap && lap.LapTime != null && !isNaN(lap.LapTime)) {
          point[abbr] = lap.LapTime
        }
      })
      return point
    })
  }, [selectedDrivers, lapsData])

  const isAnyLoading = Object.values(loadingLaps).some(Boolean)
  const title = race ? race.name.replace(' Grand Prix', '') : `Round ${round}`
  const btnLabel = selectedDrivers.length === 0
    ? 'Select drivers'
    : selectedDrivers.length === 1
      ? selectedDrivers[0]
      : `${selectedDrivers.length} drivers`

  return (
    <div className="lap-page">
      <div className="lap-header">
        <div className="lap-header-left">
          <Link to={`/race/${year}/${round}`} state={{ race }} className="back-btn">
            ← Results
          </Link>
          <div className="lap-title">
            <span className="lap-round">{sessionName} · Round {round} · {year}</span>
            <h1 className="lap-name">{title} Grand Prix</h1>
          </div>
        </div>

        <div className="lap-header-right" ref={dropdownRef}>
          <button className="driver-select-btn" onClick={() => setDropdownOpen(o => !o)}>
            {btnLabel}
            <span className="chevron">{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div className="driver-dropdown">
              {loadingDrivers ? (
                <div className="dropdown-msg">Loading drivers…</div>
              ) : allDrivers.length === 0 ? (
                <div className="dropdown-msg">No drivers found</div>
              ) : (
                allDrivers.map(d => {
                  const checked = selectedDrivers.includes(d.abbreviation)
                  const color = colorMap.current[d.abbreviation] || 'var(--text-muted)'
                  return (
                    <label key={d.abbreviation} className={`dropdown-item${checked ? ' checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDriver(d.abbreviation)}
                      />
                      <span className="dropdown-color" style={{ background: color }} />
                      <span className="dropdown-abbr">{d.abbreviation}</span>
                      <span className="dropdown-name">{d.full_name}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      <div className="lap-body">
        {isAnyLoading && <p className="status-message">Loading lap data…</p>}
        {!isAnyLoading && selectedDrivers.length === 0 && (
          <p className="status-message">Use the dropdown to select drivers and compare lap times.</p>
        )}
        {chartData.length > 0 && (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={460}>
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
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '12px' }}
                  formatter={value => (
                    <span style={{ color: colorMap.current[value] || 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
                      {value}
                    </span>
                  )}
                />
                {selectedDrivers.map(abbr => (
                  <Line
                    key={abbr}
                    type="monotone"
                    dataKey={abbr}
                    stroke={getColor(abbr)}
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
      </div>
    </div>
  )
}
