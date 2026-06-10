import { Link } from 'react-router-dom'
import './RaceCard.css'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

// Compute whether the event weekend has started, even if the race hasn't happened.
// Uses firstSessionDate when available; otherwise estimates Practice 1 as race_date - 3 days.
function effectiveStatus(race) {
  if (race.status === 'cancelled') return 'cancelled'
  const today     = new Date()
  const raceDate  = new Date(race.date)
  if (raceDate < today) return 'completed'
  const firstDate = race.firstSessionDate
    ? new Date(race.firstSessionDate)
    : new Date(raceDate.getTime() - 3 * 86400000)
  if (firstDate <= today) return 'in_progress'
  return 'upcoming'
}

function CardContent({ race, year, status }) {
  const { round, name, circuit, country, countryCode, trackMap, date } = race
  const label = name.replace(' Grand Prix', '')
  return (
    <>
      {trackMap && (
        <img
          className="race-card-track"
          src={trackMap}
          alt=""
          aria-hidden="true"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )}
      <div className="race-card-round">R{round}</div>
      <img
        className="race-card-flag"
        src={`https://flagcdn.com/w40/${countryCode}.png`}
        srcSet={`https://flagcdn.com/w80/${countryCode}.png 2x`}
        alt={country}
      />
      <div className="race-card-body">
        <div className="race-card-name">{label}</div>
        <div className="race-card-circuit">{circuit}</div>
        <div className="race-card-date">{formatDate(date)}</div>
      </div>
      {(status === 'completed' || status === 'in_progress') && (
        <div className="race-card-badge completed">Results</div>
      )}
      {status === 'upcoming' && (
        <div className="race-card-badge upcoming">Upcoming</div>
      )}
      {status === 'cancelled' && (
        <div className="race-card-badge cancelled">Cancelled</div>
      )}
    </>
  )
}

export default function RaceCard({ race, year }) {
  const { round } = race
  const status = effectiveStatus(race)

  if (status === 'cancelled' || status === 'upcoming') {
    return (
      <div className={`race-card ${status}`}>
        <CardContent race={race} year={year} status={status} />
      </div>
    )
  }

  return (
    <Link
      to={`/race/${year}/${round}`}
      state={{ race }}
      className={`race-card ${status}`}
    >
      <CardContent race={race} year={year} status={status} />
    </Link>
  )
}
