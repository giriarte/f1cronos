import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RaceDetailPage from './pages/RaceDetailPage'
import LapTimesPage from './pages/LapTimesPage'
import './App.css'

export default function App() {
  return (
    <div className="app-layout">
      <header className="topbar">
        <span className="topbar-logo">F1 <span className="topbar-logo-accent">Cronos</span></span>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/race/:year/:round" element={<RaceDetailPage />} />
        <Route path="/race/:year/:round/laps" element={<LapTimesPage />} />
      </Routes>
    </div>
  )
}
