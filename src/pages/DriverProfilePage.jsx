import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchDriverProfile } from '../api/f1Api'
import './DriverProfilePage.css'

// nationality string → ISO 3166-1 alpha-2 for flagcdn
const NATIONALITY_FLAG = {
  'Dutch': 'nl',        'British': 'gb',      'Monegasque': 'mc',
  'Australian': 'au',  'Spanish': 'es',       'Finnish': 'fi',
  'German': 'de',      'Mexican': 'mx',       'French': 'fr',
  'Canadian': 'ca',    'Thai': 'th',          'Japanese': 'jp',
  'Danish': 'dk',      'American': 'us',      'Italian': 'it',
  'New Zealander': 'nz','Brazilian': 'br',    'Austrian': 'at',
  'Argentinian': 'ar', 'Swiss': 'ch',         'Belgian': 'be',
  'Polish': 'pl',      'Russian': 'ru',       'Swedish': 'se',
  'Chinese': 'cn',     'Israeli': 'il',       'Indonesian': 'id',
}

function fmtDob(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function age(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
}

function H2HBar({ wins, losses }) {
  const total = wins + losses
  if (total === 0) return <span className="dp-h2h-na">—</span>
  const pct = Math.round((wins / total) * 100)
  return (
    <div className="dp-h2h-bar-wrap">
      <span className="dp-h2h-score">{wins}–{losses}</span>
      <div className="dp-h2h-bar">
        <div className="dp-h2h-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="dp-h2h-pct">{pct}%</span>
    </div>
  )
}

export default function DriverProfilePage() {
  const { code } = useParams()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setProfile(null)
    fetchDriverProfile(code)
      .then(setProfile)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [code])

  if (loading) return (
    <div className="app-body">
      <main className="main-content dp-loading">
        <div className="dp-spinner" />
        <p>Building driver profile… this may take a minute on first load.</p>
      </main>
    </div>
  )

  if (error) return (
    <div className="app-body">
      <main className="main-content">
        <Link to="/" className="dp-back">← Home</Link>
        <p className="dp-error">{error}</p>
      </main>
    </div>
  )

  if (!profile) return null

  const { full_name, nationality, date_of_birth, number, url, photo_url,
          junior_career, seasons, h2h } = profile

  const flagCode = NATIONALITY_FLAG[nationality]
  const driverAge = age(date_of_birth)
  const yearMin = seasons.length ? seasons[0].year : null
  const yearMax = seasons.length ? seasons[seasons.length - 1].year : null
  const activeYears = yearMin === yearMax
    ? String(yearMin)
    : `${yearMin} – ${yearMax === 2026 ? 'present' : yearMax}`

  const titles  = seasons.filter(s => s.position === 1).length
  const totWins = seasons.reduce((s, r) => s + r.wins, 0)
  const totPoles = seasons.reduce((s, r) => s + r.poles, 0)
  const totPodiums = seasons.reduce((s, r) => s + r.podiums, 0)

  const latestTeam = seasons.length ? seasons[seasons.length - 1].team : ''

  return (
    <div className="app-body">
      <main className="main-content dp-page">
        <Link to="/" className="dp-back">← Home</Link>

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="dp-header">
          {photo_url && (
            <img className="dp-photo" src={photo_url} alt={full_name} />
          )}
          <div className="dp-number">#{number || '—'}</div>
          <div className="dp-header-info">
            <h1 className="dp-name">{full_name}</h1>
            <div className="dp-meta">
              {flagCode && (
                <img
                  className="dp-flag"
                  src={`https://flagcdn.com/w40/${flagCode}.png`}
                  srcSet={`https://flagcdn.com/w80/${flagCode}.png 2x`}
                  alt={nationality}
                />
              )}
              <span>{nationality || '—'}</span>
              {date_of_birth && (
                <>
                  <span className="dp-sep">·</span>
                  <span>Born {fmtDob(date_of_birth)}{driverAge ? ` (age ${driverAge})` : ''}</span>
                </>
              )}
              {activeYears && (
                <>
                  <span className="dp-sep">·</span>
                  <span>{seasons.length} F1 season{seasons.length !== 1 ? 's' : ''} ({activeYears})</span>
                </>
              )}
            </div>
            <div className="dp-team">{latestTeam}</div>
          </div>
          {url && (
            <a className="dp-wiki" href={url} target="_blank" rel="noopener noreferrer">
              Wikipedia ↗
            </a>
          )}
        </div>

        {/* ── Career totals ────────────────────────────────────── */}
        <div className="dp-totals">
          {[
            { label: 'TITLES',   value: titles },
            { label: 'WINS',     value: totWins },
            { label: 'POLES',    value: totPoles },
            { label: 'PODIUMS',  value: totPodiums },
            { label: 'SEASONS',  value: seasons.length },
          ].map(({ label, value }) => (
            <div key={label} className={`dp-stat${label === 'TITLES' && titles > 0 ? ' dp-stat-gold' : ''}`}>
              <span className="dp-stat-value">{value}</span>
              <span className="dp-stat-label">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Junior career ────────────────────────────────────── */}
        {junior_career.length > 0 && (
          <div className="dp-section">
            <h2 className="dp-section-title">Junior Career</h2>
            <ul className="dp-junior-list">
              {junior_career.map((item, i) => (
                <li key={i} className="dp-junior-item">{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── F1 career record ─────────────────────────────────── */}
        {seasons.length > 0 && (
          <div className="dp-section">
            <h2 className="dp-section-title">F1 Career Record</h2>
            <div className="dp-table-wrap">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="dp-th-left">Team</th>
                    <th>Races</th>
                    <th>Wins</th>
                    <th>Poles</th>
                    <th>Podiums</th>
                    <th>Points</th>
                    <th>Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {[...seasons].reverse().map(s => (
                    <tr key={s.year} className={s.position === 1 ? 'dp-champion-row' : ''}>
                      <td className="dp-td-year">
                        {s.position === 1 && <span className="dp-crown" title="Champion">★</span>}
                        {s.year}
                      </td>
                      <td className="dp-td-team">{s.team}</td>
                      <td>{s.races}</td>
                      <td className={s.wins > 0 ? 'dp-td-highlight' : ''}>{s.wins}</td>
                      <td>{s.poles}</td>
                      <td>{s.podiums}</td>
                      <td>{s.points}</td>
                      <td>
                        <span className={`dp-pos dp-pos-${Math.min(s.position, 10)}`}>
                          P{s.position}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── H2H vs teammates ─────────────────────────────────── */}
        {h2h.length > 0 && (
          <div className="dp-section">
            <h2 className="dp-section-title">Head-to-Head vs Teammates</h2>
            <div className="dp-table-wrap">
              <table className="dp-table dp-h2h-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="dp-th-left">Teammate</th>
                    <th>Qualifying</th>
                    <th>Race</th>
                    <th>Points</th>
                    <th>Pts δ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...h2h].reverse().map((row, i) => {
                    const ptsDelta = row.points - row.teammate_points
                    return (
                      <tr key={i}>
                        <td className="dp-td-year">{row.year}</td>
                        <td className="dp-td-team">{row.teammate_name || row.teammate}</td>
                        <td>
                          <H2HBar wins={row.quali_wins} losses={row.quali_losses} />
                        </td>
                        <td>
                          <H2HBar wins={row.race_wins} losses={row.race_losses} />
                        </td>
                        <td className="dp-td-pts">
                          <span className="dp-pts-mine">{row.points}</span>
                          <span className="dp-pts-sep">–</span>
                          <span className="dp-pts-tm">{row.teammate_points}</span>
                        </td>
                        <td className={ptsDelta >= 0 ? 'dp-td-pos' : 'dp-td-neg'}>
                          {ptsDelta >= 0 ? '+' : ''}{ptsDelta.toFixed(0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="dp-h2h-note">
              Qualifying and race H2H counts only sessions where both drivers competed.
              Points reflect final season standings.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
