import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import './LiveTimingPage.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTOR_COLORS = {
  purple: '#B440FB',
  green:  '#39B54A',
  yellow: '#FFD700',
  grey:   '#606060',
  red:    '#9d9b9b',
}

const COMPOUND_META = {
  SOFT:         { letter: 'S', color: '#e8002d' },
  MEDIUM:       { letter: 'M', color: '#FFF200' },
  HARD:         { letter: 'H', color: '#EBEBEB' },
  INTERMEDIATE: { letter: 'I', color: '#39B54A' },
  WET:          { letter: 'W', color: '#0067FF' },
}

// Q segment → number of drivers that advance (rest are knocked out)
const SEGMENT_CUTOFFS = {
  Q1: 15, Q2: 10, Q3: null,
  SQ1: 15, SQ2: 10, SQ3: null,
  P: null,
}

// ─── Small reusable components ────────────────────────────────────────────────

function CompoundBadge({ compound, age }) {
  if (!compound) return <span className="compound-empty">—</span>
  const meta = COMPOUND_META[compound]
  const color = meta?.color ?? '#808080'
  const letter = meta?.letter ?? compound[0] ?? '?'
  return (
    <div className="compound-group">
      <span className="compound-dot" style={{ background: color }}>{letter}</span>
      <span className="compound-age">{age ?? '?'}</span>
    </div>
  )
}

const NO_BARS = [false, false, false]

const NO_BAR_COLORS = [null, null, null]

function MicroSectors({ s1, s2, s3, s1Color, s2Color, s3Color, s1Bars, s2Bars, s3Bars, s1BarColors, s2BarColors, s3BarColors, inProgress }) {
  const sectors = [
    { key: 's1', time: s1, color: s1Color, bars: s1Bars ?? NO_BARS, barColors: s1BarColors ?? NO_BAR_COLORS },
    { key: 's2', time: s2, color: s2Color, bars: s2Bars ?? NO_BARS, barColors: s2BarColors ?? NO_BAR_COLORS },
    { key: 's3', time: s3, color: s3Color, bars: s3Bars ?? NO_BARS, barColors: s3BarColors ?? NO_BAR_COLORS },
  ]

  return (
    <div className="micro-sectors">
      {sectors.map(({ key, time, color, bars, barColors }) => {
        const sectorDone = time !== null
        const anyBarDone = bars.some(Boolean)
        const sectorHex  = sectorDone ? (SECTOR_COLORS[color] ?? '#555') : '#444'
        const timeColor  = sectorDone ? sectorHex : (anyBarDone ? '#707070' : '#444')
        const timeLabel  = time != null ? time.toFixed(3) : (anyBarDone ? '···' : '—')

        return (
          <div key={key} className="micro-sector">
            <span className="micro-time" style={{ color: timeColor }}>{timeLabel}</span>
            <div className="micro-bars">
              {bars.map((done, i) => {
                // done + sector complete  → individual bar color (or sector fallback)
                // done + sector in progress → neutral (partial progress indicator)
                // not done + driver on lap → dark pulsing
                // not done + no lap       → static dark
                const barHex = barColors[i] ? (SECTOR_COLORS[barColors[i]] ?? sectorHex) : sectorHex
                let bg
                if (done && sectorDone)  bg = barHex
                else if (done)           bg = '#a0a0a0'
                else                     bg = '#282828'
                const isPending = inProgress && !done
                return (
                  <span
                    key={i}
                    className={`micro-bar${isPending ? ' micro-bar-pending' : ''}`}
                    style={{ background: bg }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    connected:    ['LIVE',       'badge-live'],
    connecting:   ['CONNECTING', 'badge-connecting'],
    disconnected: ['OFFLINE',    'badge-offline'],
    ended:        ['ENDED',      'badge-ended'],
    error:        ['ERROR',      'badge-error'],
  }
  const [label, cls] = map[status] ?? [status.toUpperCase(), '']
  return <span className={`status-badge ${cls}`}>{label}</span>
}

// ─── Timing table ─────────────────────────────────────────────────────────────

function TimingTable({ drivers, segment }) {
  const cutoff = SEGMENT_CUTOFFS[segment] ?? null
  const rows = []
  drivers.forEach((d, i) => {
    const afterCutoff = cutoff !== null && d.position !== null && d.position === cutoff + 1
    if (afterCutoff) {
      rows.push(
        <tr key="cutoff-line" className="cutoff-row">
          <td colSpan={8}>
            <span className="cutoff-label">KNOCKOUT LINE</span>
          </td>
        </tr>
      )
    }

    const isNoTime = d.position === null
    const isImproved = d.justImproved
    const rowClass = [
      'lt-row',
      i % 2 === 0 ? 'row-even' : '',
      isImproved ? 'lt-improved' : '',
      d.inProgress ? 'lt-in-progress' : '',
      isNoTime ? 'lt-no-time' : '',
    ].filter(Boolean).join(' ')

    rows.push(
      <tr key={d.abbreviation} className={rowClass}>
        <td className="lt-pos">{d.position ?? '—'}</td>
        <td className="lt-no">{d.driverNumber}</td>
        <td className="lt-team">
          <span className="team-bar" style={{ background: d.teamColor }} />
        </td>
        <td className="lt-driver">
          <span className="driver-abbr">{d.abbreviation}</span>
          <span className="driver-name">{d.fullName}</span>
        </td>
        <td className="lt-laptime mono">{d.bestLapStr ?? '—'}</td>
        <td className="lt-sectors">
          <MicroSectors
            s1={d.s1} s2={d.s2} s3={d.s3}
            s1Color={d.s1Color} s2Color={d.s2Color} s3Color={d.s3Color}
            s1Bars={d.s1Bars} s2Bars={d.s2Bars} s3Bars={d.s3Bars}
            s1BarColors={d.s1BarColors} s2BarColors={d.s2BarColors} s3BarColors={d.s3BarColors}
            inProgress={d.inProgress}
          />
        </td>
        <td className="lt-tire">
          <CompoundBadge compound={d.compound} age={d.tireAge} />
        </td>
        <td className="lt-gap mono">
          {d.gapStr ?? (d.position === 1 ? 'LEADER' : '—')}
        </td>
      </tr>
    )
  })

  return (
    <div className="lt-table-wrapper">
      <table className="lt-table">
        <thead>
          <tr>
            <th className="lt-pos">POS</th>
            <th className="lt-no">NO</th>
            <th className="lt-team" />
            <th className="lt-driver">Driver</th>
            <th className="lt-laptime">Best Lap</th>
            <th className="lt-sectors">S1 &nbsp; S2 &nbsp; S3</th>
            <th className="lt-tire">Tire</th>
            <th className="lt-gap">Gap</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}

// ─── Connection setup panel ───────────────────────────────────────────────────

function ConnectionPanel({ onConnect, error }) {
  const [year, setYear]       = useState(2025)
  const [round, setRound]     = useState(1)
  const [session, setSession] = useState('Qualifying')
  const [mode, setMode]       = useState('replay')
  const [speed, setSpeed]     = useState(10)

  return (
    <div className="connect-panel">
      <h2 className="connect-title">Live Timing</h2>
      <p className="connect-desc">
        Replay a cached historical session for testing, or connect to an active F1 live timing feed.
      </p>

      {error && <p className="lt-error">⚠ {error}</p>}

      <div className="connect-form">
        <div className="connect-row">
          <label className="connect-label">Mode</label>
          <div className="toggle-group">
            <button className={`toggle-btn${mode === 'replay' ? ' active' : ''}`} onClick={() => setMode('replay')}>Replay</button>
            <button className={`toggle-btn${mode === 'live' ? ' active' : ''}`}   onClick={() => setMode('live')}>Live</button>
          </div>
        </div>

        {mode === 'replay' && (
          <>
            <div className="connect-row">
              <label className="connect-label">Year</label>
              <input
                type="number" className="connect-input"
                value={year} min={2020} max={2026}
                onChange={e => setYear(+e.target.value)}
              />
            </div>
            <div className="connect-row">
              <label className="connect-label">Round</label>
              <input
                type="number" className="connect-input"
                value={round} min={1} max={24}
                onChange={e => setRound(+e.target.value)}
              />
            </div>
            <div className="connect-row">
              <label className="connect-label">Session</label>
              <select className="connect-select" value={session} onChange={e => setSession(e.target.value)}>
                <option>Qualifying</option>
                <option>Sprint Qualifying</option>
                <option>Practice 1</option>
                <option>Practice 2</option>
                <option>Practice 3</option>
              </select>
            </div>
            <div className="connect-row">
              <label className="connect-label">Speed</label>
              <div className="toggle-group">
                {[1, 5, 10, 20, 50].map(s => (
                  <button key={s} className={`toggle-btn${speed === s ? ' active' : ''}`} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {mode === 'live' && (
          <p className="connect-note">
            Connects to <code>livetiming.formula1.com</code> via FastF1. Data is only
            available during active F1 sessions (~5 s delay). Live messages are raw
            SignalR frames and not yet parsed into the structured format below.
          </p>
        )}

        <button className="connect-btn" onClick={() => onConnect({ year, round, session, mode, speed })}>
          {mode === 'live' ? 'Connect to Live Feed' : 'Start Replay'}
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveTimingPage() {
  const { status, sessionInfo, currentSegment, segmentData, error, connect, disconnect } = useWebSocket()
  const [viewingSegment, setViewingSegment] = useState(null)

  // Auto-follow the live segment unless user pinned another tab
  const activeSegment = viewingSegment ?? currentSegment
  const update = activeSegment ? segmentData[activeSegment] : null
  const drivers = update?.drivers ?? []

  // When a new segment starts, unpin so we auto-follow
  useEffect(() => {
    setViewingSegment(null)
  }, [currentSegment])

  const handleConnect = (params) => {
    setViewingSegment(null)
    connect(params)
  }

  const isActive = status === 'connected' || status === 'ended' || status === 'connecting'

  if (!isActive) {
    return (
      <div className="live-page">
        <div className="live-header">
          <Link to="/" className="back-btn">← Back</Link>
          <h1 className="live-title">Live Timing</h1>
        </div>
        <ConnectionPanel onConnect={handleConnect} error={error} />
      </div>
    )
  }

  const segments = sessionInfo?.segments ?? []

  return (
    <div className="live-page">
      {/* ── Page header ── */}
      <div className="live-header">
        <Link to="/" className="back-btn">← Back</Link>
        <div className="live-header-center">
          <span className="live-session-label">
            {sessionInfo
              ? `${sessionInfo.year} · Rd ${sessionInfo.round} · ${sessionInfo.sessionName}`
              : 'Loading session…'}
          </span>
          <StatusBadge status={status} />
        </div>
        <button className="disconnect-btn" onClick={disconnect}>Disconnect</button>
      </div>

      {/* ── Segment tabs ── */}
      {segments.length > 1 && (
        <div className="segment-tabs">
          {segments.map(seg => {
            const isLive    = seg === currentSegment
            const isViewing = seg === activeSegment
            return (
              <button
                key={seg}
                className={`seg-tab${isViewing ? ' active' : ''}${isLive ? ' live' : ''}`}
                onClick={() => setViewingSegment(isLive ? null : seg)}
              >
                {seg}
                {isLive && <span className="seg-live-dot" />}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Content ── */}
      <div className="lt-body">
        {status === 'connecting' && (
          <p className="status-message">Connecting and loading session data… this may take a moment.</p>
        )}
        {status === 'ended' && (
          <p className="status-message">Session ended. Showing final standings.</p>
        )}

        {drivers.length > 0 ? (
          <TimingTable drivers={drivers} segment={activeSegment} />
        ) : (
          status === 'connected' && (
            <p className="status-message">Waiting for first timed lap…</p>
          )
        )}
      </div>
    </div>
  )
}
