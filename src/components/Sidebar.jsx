import { SEASONS } from '../data/seasons'
import './Sidebar.css'

export default function Sidebar({ activeSeason, onSeasonSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <h3 className="sidebar-label">Seasons</h3>
        <ul className="season-list">
          {SEASONS.map((year) => (
            <li key={year}>
              <button
                className={`season-btn ${activeSeason === year ? 'active' : ''}`}
                onClick={() => onSeasonSelect(year)}
              >
                {year}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
