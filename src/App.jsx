import { Routes, Route } from 'react-router-dom'
import { Link } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RaceDetailPage from './pages/RaceDetailPage'
import LapTimesPage from './pages/LapTimesPage'
import ChampionshipProgressionPage from './pages/ChampionshipProgressionPage'
import LiveTimingPage from './pages/LiveTimingPage'
import './App.css'

export default function App() {
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
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/race/:year/:round" element={<RaceDetailPage />} />
        <Route path="/race/:year/:round/laps" element={<LapTimesPage />} />
        <Route path="/championship/:year" element={<ChampionshipProgressionPage />} />
        <Route path="/live" element={<LiveTimingPage />} />
      </Routes>
    </div>
  )
}
