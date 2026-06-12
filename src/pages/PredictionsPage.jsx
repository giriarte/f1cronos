import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { fetchPredictions, fetchResults } from '../api/f1Api'
import './PredictionsPage.css'

const PODIUM_LABELS = { 1: '1st', 2: '2nd', 3: '3rd' }
const PODIUM_COLORS = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' }

const DRIVER_NAMES = {
  ALB: 'Alexander Albon',   ALO: 'Fernando Alonso',   ANT: 'Kimi Antonelli',
  BEA: 'Oliver Bearman',    BOR: 'Gabriel Bortoleto', BOT: 'Valtteri Bottas',
  COL: 'Franco Colapinto',  GAS: 'Pierre Gasly',      HAD: 'Isack Hadjar',
  HAM: 'Lewis Hamilton',    HUL: 'Nico Hülkenberg',   LAW: 'Liam Lawson',
  LEC: 'Charles Leclerc',   LIN: 'Arvid Lindblad',    NOR: 'Lando Norris',
  OCO: 'Esteban Ocon',      PER: 'Sergio Pérez',      PIA: 'Oscar Piastri',
  RUS: 'George Russell',    SAI: 'Carlos Sainz',      STR: 'Lance Stroll',
  VER: 'Max Verstappen',
}

const driverName = (abbr, fallback) => DRIVER_NAMES[abbr] || fallback || abbr

const COUNTRY_CODE = {
  'Australia': 'au', 'China': 'cn', 'Japan': 'jp', 'Bahrain': 'bh',
  'Saudi Arabia': 'sa', 'United Arab Emirates': 'ae', 'USA': 'us',
  'United States': 'us', 'Canada': 'ca', 'Monaco': 'mc', 'Spain': 'es',
  'Austria': 'at', 'United Kingdom': 'gb', 'Great Britain': 'gb',
  'Belgium': 'be', 'Hungary': 'hu', 'Netherlands': 'nl', 'Italy': 'it',
  'Azerbaijan': 'az', 'Singapore': 'sg', 'Mexico': 'mx', 'Brazil': 'br',
  'Qatar': 'qa', 'Las Vegas': 'us', 'Miami': 'us',
}

function buildTableRows(predictedOrder, actualResults) {
  const predMap = {}
  if (predictedOrder) {
    predictedOrder.forEach(p => { predMap[p.driver] = p })
  }

  const actualMap = {}
  if (actualResults) {
    actualResults.forEach(r => { actualMap[r.abbreviation] = r })
  }

  const allDrivers = new Set([...Object.keys(predMap), ...Object.keys(actualMap)])
  if (allDrivers.size === 0) return []

  const rows = Array.from(allDrivers).map(abbr => {
    const pred = predMap[abbr]
    const actual = actualMap[abbr]
    const rawActual = actual ? (actual.classifiedPosition || String(actual.position || '')) : null
    const isNumeric = v => v != null && /^\d+$/.test(String(v))
    return {
      driver: abbr,
      fullName: driverName(abbr, actual?.fullName),
      team: actual?.teamName || pred?.team || '',
      teamColor: actual?.teamColor || null,
      predictedPos: pred?.position ?? null,
      actualPos: rawActual,
      actualIsNumeric: isNumeric(rawActual),
    }
  })

  const hasActual = actualResults && actualResults.length > 0
  rows.sort((a, b) => {
    if (hasActual) {
      const aPos = parseInt(a.actualPos) || 99
      const bPos = parseInt(b.actualPos) || 99
      return aPos - bPos
    }
    return (a.predictedPos || 99) - (b.predictedPos || 99)
  })

  return rows
}

function StandingsTable({ title, predictedOrder, actualResults, loadingActual }) {
  const rows = buildTableRows(predictedOrder, actualResults)
  if (rows.length === 0 && !loadingActual) return null

  return (
    <div className="pred-standings-card">
      <div className="pred-section-label">{title}</div>
      <div className="pred-table-wrap">
        <table className="pred-table">
          <thead>
            <tr>
              <th className="pred-th-pos">Pos</th>
              <th className="pred-th-driver">Driver</th>
              <th className="pred-th-team">Team</th>
              <th className="pred-th-pred">Prediction</th>
              <th className="pred-th-actual">Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.driver} className="pred-tr">
                <td className="pred-td-pos">{i + 1}</td>
                <td className="pred-td-driver">
                  <div className="pred-driver-inner">
                    {r.teamColor && (
                      <span className="pred-team-bar" style={{ background: r.teamColor }} />
                    )}
                    <span className="pred-driver-full">{r.fullName}</span>
                    <span className="pred-driver-abbr">{r.driver}</span>
                  </div>
                </td>
                <td className="pred-td-team">{r.team}</td>
                <td className="pred-td-pred">
                  {r.predictedPos != null ? `P${r.predictedPos}` : '—'}
                </td>
                <td className="pred-td-actual">
                  {r.actualPos != null
                    ? r.actualIsNumeric
                      ? <span className="pred-actual-pos">P{r.actualPos}</span>
                      : <span className="pred-dnf-tag">{r.actualPos}</span>
                    : <span className="pred-pending">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PredictionsPage() {
  const { year, round } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [raceResults, setRaceResults] = useState(null)
  const [qualiResults, setQualiResults] = useState(null)

  function loadPredictions(force = false) {
    setLoading(true)
    setError(null)
    setData(null)
    fetchPredictions(Number(year), Number(round), force)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadPredictions() }, [year, round])

  useEffect(() => {
    setRaceResults(null)
    setQualiResults(null)
    fetchResults(year, round, 'Race').then(setRaceResults).catch(() => {})
    fetchResults(year, round, 'Qualifying').then(setQualiResults).catch(() => {})
  }, [year, round])

  const countryCode = data ? COUNTRY_CODE[data.country] || '' : ''

  return (
    <div className="app-body">
      <Sidebar activeSeason={Number(year)} onSeasonSelect={() => {}} />
      <main className="main-content">
        <div className="pred-back-row">
          <Link to="/" className="pred-back-link">← Back</Link>
          {!loading && (
            <button className="pred-refresh-btn" onClick={() => loadPredictions(true)}>
              ↻ Regenerate
            </button>
          )}
        </div>

        {loading && (
          <div className="pred-loading">
            <div className="pred-loading-spinner" />
            <p>Generating AI predictions…</p>
            <p className="pred-loading-sub">This may take a moment on first load.</p>
          </div>
        )}

        {error && (
          <div className="pred-error">
            <p>Failed to load predictions.</p>
            <p className="pred-error-detail">{error}</p>
          </div>
        )}

        {data && (
          <div className="pred-content">
            <div className="pred-header">
              {countryCode && (
                <img
                  className="pred-flag"
                  src={`https://flagcdn.com/w40/${countryCode}.png`}
                  srcSet={`https://flagcdn.com/w80/${countryCode}.png 2x`}
                  alt={data.country}
                />
              )}
              <div>
                <div className="pred-label">AI Predictions</div>
                <h2 className="pred-title">{data.race_name}</h2>
                <div className="pred-circuit">{data.circuit}, {data.country}</div>
              </div>
            </div>

            <div className="pred-summary-card">
              <div className="pred-section-label">Race Preview</div>
              <p className="pred-summary-text">{data.summary}</p>
            </div>

            <div className="pred-section-label">Predicted Podium</div>
            <div className="pred-podium">
              {data.podium.map(p => (
                <div key={p.position} className="pred-podium-card">
                  <div className="pred-podium-pos" style={{ color: PODIUM_COLORS[p.position] }}>
                    {PODIUM_LABELS[p.position]}
                  </div>
                  <div className="pred-podium-driver">{driverName(p.driver)}</div>
                  <div className="pred-podium-team">{p.team}</div>
                  <p className="pred-podium-rationale">{p.rationale}</p>
                </div>
              ))}
            </div>

            <div className="pred-bottom-grid">
              <div className="pred-card">
                <div className="pred-section-label">Dark Horse</div>
                <div className="pred-dh-driver">{driverName(data.dark_horse.driver)}</div>
                <div className="pred-dh-team">{data.dark_horse.team}</div>
                <p className="pred-dh-rationale">{data.dark_horse.rationale}</p>
              </div>

              {data.dnf_risks && data.dnf_risks.length > 0 && (
                <div className="pred-card">
                  <div className="pred-section-label">DNF Risks</div>
                  <div className="pred-dnf-list">
                    {data.dnf_risks.map((d, i) => (
                      <div key={i} className="pred-dnf-row">
                        <span className="pred-dnf-driver">{driverName(d.driver)}</span>
                        <span className="pred-dnf-team">{d.team}</span>
                        <p className="pred-dnf-reason">{d.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <StandingsTable
              title="Race Standings"
              predictedOrder={data.predicted_race_order}
              actualResults={raceResults}
            />

            <StandingsTable
              title="Qualy Standings"
              predictedOrder={data.predicted_quali_order}
              actualResults={qualiResults}
            />

            {data.generated_at && (
              <p className="pred-generated-at">
                Generated {new Date(data.generated_at).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
