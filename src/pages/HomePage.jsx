import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import RaceCard from '../components/RaceCard'
import { RACES_BY_SEASON, SEASONS } from '../data/seasons'
import { fetchSchedule } from '../api/f1Api'
import { mapScheduleToRaces } from '../utils/scheduleMapper'

const CURRENT_SEASON = 2026

export default function HomePage() {
  const [activeSeason, setActiveSeason] = useState(CURRENT_SEASON)
  const [races, setRaces] = useState(RACES_BY_SEASON[CURRENT_SEASON])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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

  return (
    <div className="app-body">
      <Sidebar activeSeason={activeSeason} onSeasonSelect={setActiveSeason} />

      <main className="main-content">
        <h2 className="season-title">{activeSeason} Season</h2>

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
