import { useState } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { SEASONS } from './data/seasons'
import HomePage from './pages/HomePage'
import RaceDetailPage from './pages/RaceDetailPage'
import LapTimesPage from './pages/LapTimesPage'
import ChampionshipProgressionPage from './pages/ChampionshipProgressionPage'
import LiveTimingPage from './pages/LiveTimingPage'
import PredictionsPage from './pages/PredictionsPage'
import DriverProfilePage from './pages/DriverProfilePage'
import './App.css'

const CURRENT_SEASON = 2026

export default function App() {
  const [activeSeason, setActiveSeason] = useState(CURRENT_SEASON)
  const location = useLocation()

  return (
    <div className="app-layout">
      <header className="topbar">
        <Link to="/" className="topbar-logo-link">
          <span className="topbar-logo">F1 <span className="topbar-logo-accent">Cronos</span></span>
        </Link>
        <nav className="topbar-nav">
          <Link to="/live" className="topbar-nav-link">
            Replay
          </Link>
        </nav>
        {location.pathname === '/' && (
          <select
            className="season-select"
            value={activeSeason}
            onChange={(e) => setActiveSeason(Number(e.target.value))}
          >
            {SEASONS.map(year => (
              <option key={year} value={year}>{year} Season</option>
            ))}
          </select>
        )}
      </header>

      <Routes>
        <Route path="/" element={<HomePage activeSeason={activeSeason} />} />
        <Route path="/race/:year/:round" element={<RaceDetailPage />} />
        <Route path="/race/:year/:round/laps" element={<LapTimesPage />} />
        <Route path="/championship/:year" element={<ChampionshipProgressionPage />} />
        <Route path="/live" element={<LiveTimingPage />} />
        <Route path="/predictions/:year/:round" element={<PredictionsPage />} />
        <Route path="/driver/:code" element={<DriverProfilePage />} />
      </Routes>
    </div>
  )
}
