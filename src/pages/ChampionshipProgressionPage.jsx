import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useLocation, useSearchParams, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { fetchDriverStats } from '../api/f1Api'
import './ChampionshipProgressionPage.css'

const FALLBACK_COLORS = [
  '#e10600', '#0090ff', '#39b54a', '#ffd700', '#ff8700',
  '#b440fb', '#00d2be', '#f596c8', '#006f62', '#52e252',
]

const RACE_FLAG = {
  // Adjective forms (FastF1 EventName after stripping " Grand Prix")
  'Australian': 'au', 'Chinese': 'cn', 'Japanese': 'jp',
  'Saudi Arabian': 'sa', 'Spanish': 'es', 'Canadian': 'ca',
  'Austrian': 'at', 'Styrian': 'at', 'British': 'gb',
  'Hungarian': 'hu', 'Belgian': 'be', 'Dutch': 'nl',
  'Italian': 'it', 'Tuscan': 'it', 'Turkish': 'tr',
  'Russian': 'ru', 'Portuguese': 'pt', 'French': 'fr',
  'Korean': 'kr', 'Indian': 'in', 'Malaysian': 'my',
  'Mexican': 'mx', 'Brazilian': 'br', 'German': 'de',
  'European': 'az',
  // Noun / city forms
  'Bahrain': 'bh', 'Australia': 'au', 'China': 'cn',
  'Japan': 'jp', 'Saudi Arabia': 'sa', 'Miami': 'us',
  'Emilia Romagna': 'it', 'Emilia-Romagna': 'it',
  'Monaco': 'mc', 'Spain': 'es', 'Canada': 'ca',
  'Austria': 'at', 'Styria': 'at', 'Great Britain': 'gb',
  'Hungary': 'hu', 'Belgium': 'be', 'Netherlands': 'nl',
  'Italy': 'it', 'Tuscany': 'it', 'Azerbaijan': 'az',
  'Singapore': 'sg', 'United States': 'us',
  'Mexico City': 'mx', 'Mexico': 'mx',
  'São Paulo': 'br', 'Sao Paulo': 'br', 'Brazil': 'br',
  'Las Vegas': 'us', 'Qatar': 'qa', 'Abu Dhabi': 'ae',
  'Turkey': 'tr', 'Russia': 'ru', 'Portugal': 'pt',
  'Eifel': 'de', 'Germany': 'de', 'France': 'fr',
  '70th Anniversary': 'gb',
}

function CustomXAxisTick({ x, y, payload, activeData }) {
  const round = activeData.find(r => r.round === payload.value)
  const code = round ? (RACE_FLAG[round.name] || '') : ''
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="var(--text-muted)" fontSize={11}>
        {payload.value}
      </text>
      {code && (
        <image
          href={`https://flagcdn.com/w20/${code}.png`}
          x={-10}
          y={20}
          width={20}
          height={14}
        />
      )}
    </g>
  )
}

const TABS = [
  { key: 'championship', label: 'Championship'  },
  { key: 'race',         label: 'Race'           },
  { key: 'qualifying',   label: 'Qualifying'     },
  { key: 'sprint',       label: 'Sprint'         },
  { key: 'sprint_quali', label: 'Sprint Qualy'   },
]

function CustomTooltip({ active, payload, label, activeData, activeTab }) {
  if (!active || !payload?.length) return null
  const round = activeData.find(r => r.round === label)
  return (
    <div className="chart-tooltip">
      <p className="tooltip-lap">{round?.name ?? `Round ${label}`}</p>
      {payload
        .filter(e => e.value != null)
        .sort((a, b) => a.value - b.value)
        .map(entry => {
          const d = round?.drivers?.[entry.dataKey]
          const pts = activeTab === 'championship' && d?.points != null
            ? ` · ${d.points} pts`
            : ''
          return (
            <div key={entry.dataKey} className="tooltip-row">
              <span className="tooltip-dot" style={{ background: entry.color }} />
              <span className="tooltip-abbr">{entry.dataKey}</span>
              <span className="tooltip-time">
                {d ? `P${d.position}${pts}` : '—'}
              </span>
            </div>
          )
        })}
    </div>
  )
}

export default function ChampionshipProgressionPage() {
  const { year } = useParams()
  const { state } = useLocation()
  const [searchParams] = useSearchParams()
  const { round, standings = [] } = state || {}
  const initialDriver = state?.initialDriver ?? searchParams.get('driver')

  const [driverStats, setDriverStats] = useState({ championship: [], race: [], qualifying: [], sprint: [], sprint_quali: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('championship')
  const [selectedDrivers, setSelectedDrivers] = useState(initialDriver ? [initialDriver] : [])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  const colorMap = useRef(
    Object.fromEntries(standings.map(d => [d.abbreviation, d.teamColor]))
  )
  const fallbackIdx = useRef(0)

  function getColor(abbr) {
    if (!colorMap.current[abbr]) {
      colorMap.current[abbr] = FALLBACK_COLORS[fallbackIdx.current % FALLBACK_COLORS.length]
      fallbackIdx.current++
    }
    return colorMap.current[abbr]
  }

  useEffect(() => {
    fetchDriverStats(year)
      .then(data => {
        setDriverStats(data)
        ;['championship', 'race', 'qualifying', 'sprint', 'sprint_quali'].forEach(tab => {
          const rounds = data[tab]
          if (rounds.length > 0) {
            Object.entries(rounds[rounds.length - 1].drivers).forEach(([abbr, info]) => {
              if (!colorMap.current[abbr] && info.teamColor)
                colorMap.current[abbr] = info.teamColor
            })
          }
        })
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [year])

  // Build unified driver list sorted by championship standing
  const allDrivers = useMemo(() => {
    const driverMap = {}
    ;['championship', 'race', 'qualifying'].forEach(tab => {
      const rounds = driverStats[tab]
      if (rounds.length > 0) {
        Object.entries(rounds[rounds.length - 1].drivers).forEach(([abbr, info]) => {
          if (!driverMap[abbr]) driverMap[abbr] = info
        })
      }
    })
    const champLast = driverStats.championship.at(-1)
    return Object.entries(driverMap)
      .sort((a, b) => {
        const posA = champLast?.drivers[a[0]]?.position ?? 999
        const posB = champLast?.drivers[b[0]]?.position ?? 999
        return posA - posB
      })
      .map(([abbr, info]) => ({ abbreviation: abbr, fullName: info.fullName, teamColor: info.teamColor }))
  }, [driverStats])

  const numDrivers = allDrivers.length || 20
  const yTicks = [1, 5, 10, 15, 20].filter(t => t <= numDrivers)

  const activeData = driverStats[activeTab]

  const chartData = useMemo(() => {
    return activeData.map(r => {
      const point = { round: r.round, name: r.name }
      selectedDrivers.forEach(abbr => {
        const d = r.drivers[abbr]
        if (d) point[abbr] = d.position
      })
      return point
    })
  }, [activeData, selectedDrivers])

  function toggleDriver(abbr) {
    setSelectedDrivers(prev =>
      prev.includes(abbr) ? prev.filter(d => d !== abbr) : [...prev, abbr]
    )
  }

  useEffect(() => {
    function onMouseDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const btnLabel = selectedDrivers.length === 0
    ? 'Select drivers'
    : selectedDrivers.length === 1
      ? selectedDrivers[0]
      : `${selectedDrivers.length} drivers`

  return (
    <div className="champ-page">
      <div className="champ-header">
        <div className="champ-header-left">
          {round
            ? <Link to={`/race/${year}/${round}`} className="back-btn">← Results</Link>
            : <Link to="/" className="back-btn">← Home</Link>
          }
          <div className="champ-title">
            <span className="champ-subtitle">{year} Season</span>
            <h1 className="champ-name">Drivers Stats</h1>
          </div>
        </div>

        <div className="champ-header-right" ref={dropdownRef}>
          <button className="driver-select-btn" onClick={() => setDropdownOpen(o => !o)}>
            {btnLabel}
            <span className="chevron">{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div className="driver-dropdown">
              {loading ? (
                <div className="dropdown-msg">Loading…</div>
              ) : allDrivers.length === 0 ? (
                <div className="dropdown-msg">No data available</div>
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
                      <span className="dropdown-name">{d.fullName}</span>
                    </label>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      <div className="champ-body">
        {loading && <p className="status-message">Loading driver stats…</p>}
        {error && <p className="status-message error">Error: {error}</p>}

        {!loading && !error && (
          <>
            <div className="stats-tabs">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`stats-tab${activeTab === key ? ' active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {selectedDrivers.length === 0 ? (
              <p className="status-message">Use the dropdown to select drivers and compare their progression.</p>
            ) : chartData.length === 0 ? (
              <p className="status-message">No data available for this period.</p>
            ) : (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={460}>
                  <LineChart data={chartData} margin={{ top: 8, right: 32, bottom: 8, left: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="round"
                      height={52}
                      tick={(props) => <CustomXAxisTick {...props} activeData={activeData} />}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                    />
                    <YAxis
                      reversed
                      domain={[1, numDrivers]}
                      ticks={yTicks}
                      tickFormatter={v => `P${v}`}
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                      allowDecimals={false}
                      width={48}
                    />
                    <Tooltip
                      content={
                        <CustomTooltip
                          activeData={activeData}
                          activeTab={activeTab}
                        />
                      }
                    />
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
                        dot={{ r: 3, strokeWidth: 0, fill: getColor(abbr) }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
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
    </div>
  )
}
