import { Link } from 'react-router-dom'
import './RaceCard.css'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

function CardContent({ race, year }) {
  const { round, name, circuit, country, countryCode, trackMap, date, status } = race
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
      {status === 'completed' && (
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
  const { round, status } = race

  if (status === 'cancelled' || status === 'upcoming') {
    return (
      <div className={`race-card ${status}`}>
        <CardContent race={race} year={year} />
      </div>
    )
  }

  return (
    <Link
      to={`/race/${year}/${round}`}
      state={{ race }}
      className={`race-card ${status}`}
    >
      <CardContent race={race} year={year} />
    </Link>
  )
}
