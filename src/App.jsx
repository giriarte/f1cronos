import { useState } from 'react'
import Sidebar from './components/Sidebar'
import RaceCard from './components/RaceCard'
import { RACES_BY_SEASON } from './data/seasons'
import './App.css'

export default function App() {
  const [activeSeason, setActiveSeason] = useState(2026)
  const races = RACES_BY_SEASON[activeSeason] ?? []

  return (
    <div className="app-layout">
      <header className="topbar">
        <span className="topbar-logo">F1 <span className="topbar-logo-accent">Cronos</span></span>
      </header>

      <div className="app-body">
        <Sidebar activeSeason={activeSeason} onSeasonSelect={setActiveSeason} />

        <main className="main-content">
          <h2 className="season-title">{activeSeason} Season</h2>
          <div className="race-grid">
            {races.map((race) => (
              <RaceCard key={race.round} race={race} />
            ))}
          </div>
          <footer className="main-footer">
            Circuit maps by{' '}
            <a href="https://github.com/julesr0y/f1-circuits-svg" target="_blank" rel="noopener noreferrer">
              julesr0y
            </a>{' '}
            (CC BY 4.0)
          </footer>
        </main>
      </div>
    </div>
  )
}
