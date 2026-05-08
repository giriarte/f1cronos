const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function fetchSchedule(year) {
  const res = await fetch(`${BASE_URL}/schedule/${year}`)
  if (!res.ok) throw new Error(`Failed to fetch ${year} schedule (${res.status})`)
  return res.json()
}

export async function fetchSessions(year, round, eventDate) {
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/sessions/${year}/${round}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch sessions (${res.status})`)
  return res.json()
}

export async function fetchResults(year, round, sessionName, eventDate) {
  const encoded = encodeURIComponent(sessionName)
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/results/${year}/${round}/${encoded}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch results (${res.status})`)
  return res.json()
}

export async function fetchQualiSectors(year, round, sessionName, eventDate) {
  const encoded = encodeURIComponent(sessionName)
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/quali-sectors/${year}/${round}/${encoded}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch quali sectors (${res.status})`)
  return res.json()
}

export async function fetchStandings(year, round, eventDate) {
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/standings/${year}/${round}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch standings (${res.status})`)
  return res.json()
}

export async function fetchLaps(year, round, sessionName, driver) {
  const encoded = encodeURIComponent(sessionName)
  const res = await fetch(`${BASE_URL}/laps/${year}/${round}/${encoded}/${driver}`)
  if (!res.ok) throw new Error(`Failed to fetch laps (${res.status})`)
  return res.json()
}

export async function fetchDrivers(year, round, sessionName) {
  const encoded = encodeURIComponent(sessionName)
  const res = await fetch(`${BASE_URL}/drivers/${year}/${round}/${encoded}`)
  if (!res.ok) throw new Error(`Failed to fetch drivers (${res.status})`)
  return res.json()
}
