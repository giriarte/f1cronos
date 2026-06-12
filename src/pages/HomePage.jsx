import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import RaceCard from '../components/RaceCard'
import { RACES_BY_SEASON, SEASONS } from '../data/seasons'
import { fetchSchedule, fetchStandings, fetchNextEvent } from '../api/f1Api'
import { mapScheduleToRaces } from '../utils/scheduleMapper'
import './HomePage.css'

const COUNTRY_CODE = {
  'Australia': 'au', 'China': 'cn', 'Japan': 'jp', 'Bahrain': 'bh',
  'Saudi Arabia': 'sa', 'United Arab Emirates': 'ae', 'USA': 'us',
  'United States': 'us', 'Canada': 'ca', 'Monaco': 'mc', 'Spain': 'es',
  'Austria': 'at', 'United Kingdom': 'gb', 'Great Britain': 'gb',
  'Belgium': 'be', 'Hungary': 'hu', 'Netherlands': 'nl', 'Italy': 'it',
  'Azerbaijan': 'az', 'Singapore': 'sg', 'Mexico': 'mx', 'Brazil': 'br',
  'Qatar': 'qa', 'Las Vegas': 'us', 'Miami': 'us',
}

const SESSION_COLORS = {
  'Race':        '#e10600',
  'Sprint Race': '#ff8700',
  'Qualifying':  '#4da6ff',
  'Sprint Qualy':'#b440fb',
  'Practice 1':  '#00c896',
  'Practice 2':  '#00c896',
  'Practice 3':  '#00c896',
}

function formatEventDatetime(isoStr) {
  const d = new Date(isoStr)
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return { date, time }
}

function Countdown({ datetime }) {
  const [remaining, setRemaining] = useState(() => datetime - Date.now())

  useEffect(() => {
    const id = setInterval(() => setRemaining(datetime - Date.now()), 1000)
    return () => clearInterval(id)
  }, [datetime])

  if (remaining <= 0) return null

  const totalSec = Math.floor(remaining / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  const parts = d > 0
    ? [`${d}d`, `${h}h`, `${m}m`]
    : [`${h}h`, `${m}m`, `${String(s).padStart(2, '0')}s`]

  return (
    <div className="ne-countdown">
      {parts.map((p, i) => <span key={i} className="ne-count-part">{p}</span>)}
    </div>
  )
}

function LiveButton({ ts }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const isLive = now >= ts
  return isLive
    ? <Link to="/live" className="ne-live-btn ne-live-active">● LIVE</Link>
    : <span className="ne-live-btn ne-live-disabled">● LIVE</span>
}

function NextEventWidget({ year }) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setEvent(null)
    fetchNextEvent(year)
      .then(data => setEvent(data.next))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false))
  }, [year])

  if (loading) return null
  if (!event) return null

  const code = COUNTRY_CODE[event.country] || ''
  const color = SESSION_COLORS[event.session] || 'var(--text-secondary)'
  const { date, time } = formatEventDatetime(event.datetime)
  const ts = new Date(event.datetime).getTime()

  return (
    <div className="next-event-card">
      <div className="ne-label">Next Up</div>
      <div className="ne-main">
        <div className="ne-left">
          <div className="ne-race-info">
            {code && (
              <img
                className="ne-flag"
                src={`https://flagcdn.com/w40/${code}.png`}
                srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
                alt={event.country}
              />
            )}
            <div>
              <div className="ne-name">{event.name} Grand Prix</div>
              <div className="ne-location">{event.location}</div>
            </div>
          </div>
          <Link to={`/predictions/${year}/${event.round}`} className="ne-predictions-btn">
            Predictions
          </Link>
        </div>
        <div className="ne-right">
          <div className="ne-session-row">
            <span className="ne-session-badge" style={{ color, borderColor: color, background: `${color}18` }}>
              {event.session}
            </span>
            <LiveButton ts={ts} />
          </div>
          <div className="ne-datetime">
            <span className="ne-date">{date}</span>
            <span className="ne-time">{time}</span>
          </div>
          <Countdown datetime={ts} />
        </div>
      </div>
    </div>
  )
}

const CURRENT_SEASON = 2026

function StandingsWidget({ standings, loading, expanded, onToggle, year }) {
  if (!loading && standings.length === 0) return null
  const visible = expanded ? standings : standings.slice(0, 5)
  return (
    <div className="home-standings">
      <h3 className="home-standings-title">Driver Championship</h3>
      {loading ? (
        <p className="hs-loading">Loading standings…</p>
      ) : (
        <>
          <div className="hs-list">
            {visible.map(d => (
              <div key={d.abbreviation} className="hs-row">
                <span className="hs-pos">{d.position}</span>
                <span className="hs-bar" style={{ background: d.teamColor }} />
                <span className="hs-abbr">{d.abbreviation}</span>
                <span className="hs-name">{d.fullName}</span>
                <span className="hs-pts">{d.points} pts</span>
                <a
                  href={`/championship/${year}?driver=${d.abbreviation}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hs-stats-btn"
                >
                  Stats
                </a>
              </div>
            ))}
          </div>
          {standings.length > 5 && (
            <button className="hs-toggle" onClick={onToggle}>
              {expanded
                ? 'See less ▲'
                : `See more (${standings.length - 5} more) ▼`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function HomePage() {
  const [activeSeason, setActiveSeason] = useState(CURRENT_SEASON)
  const [races, setRaces] = useState(RACES_BY_SEASON[CURRENT_SEASON])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [standings, setStandings] = useState([])
  const [loadingStandings, setLoadingStandings] = useState(true)
  const [standingsExpanded, setStandingsExpanded] = useState(false)

  useEffect(() => {
    if (activeSeason === CURRENT_SEASON) {
      setRaces(RACES_BY_SEASON[CURRENT_SEASON])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchSchedule(activeSeason)
      .then((data) => { if (!cancelled) setRaces(mapScheduleToRaces(data)) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [activeSeason])

  useEffect(() => {
    let cancelled = false
    setStandings([])
    setStandingsExpanded(false)
    setLoadingStandings(true)
    const today = new Date().toISOString().split('T')[0]
    fetchStandings(activeSeason, 99, today)
      .then(data => { if (!cancelled) setStandings(data) })
      .catch(() => { if (!cancelled) setStandings([]) })
      .finally(() => { if (!cancelled) setLoadingStandings(false) })
    return () => { cancelled = true }
  }, [activeSeason])

  return (
    <div className="app-body">
      <Sidebar activeSeason={activeSeason} onSeasonSelect={setActiveSeason} />

      <main className="main-content">
        <h2 className="season-title">{activeSeason} Season</h2>

        <NextEventWidget year={activeSeason} />

        <StandingsWidget
          standings={standings}
          loading={loadingStandings}
          expanded={standingsExpanded}
          onToggle={() => setStandingsExpanded(e => !e)}
          year={activeSeason}
        />

        {loading && <p className="status-message">Loading schedule…</p>}
        {error && <p className="status-message error">Error: {error}</p>}

        {!loading && !error && (
          <div className="race-grid">
            {races.map((race) => (
              <RaceCard key={race.round} race={race} year={activeSeason} />
            ))}
          </div>
        )}

        <footer className="main-footer">
          Circuit maps by{' '}
          <a href="https://github.com/julesr0y/f1-circuits-svg" target="_blank" rel="noopener noreferrer">
            julesr0y
          </a>{' '}
          (CC BY 4.0)
        </footer>
      </main>
    </div>
  )
}
