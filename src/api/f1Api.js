const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function apiError(res, fallback) {
  try {
    const body = await res.json()
    if (body?.detail) return new Error(body.detail)
  } catch {}
  return new Error(fallback)
}

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
  if (!res.ok) throw await apiError(res, `Failed to fetch results (${res.status})`)
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

export async function fetchLaps(year, round, sessionName, driver, eventDate) {
  const encoded = encodeURIComponent(sessionName)
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/laps/${year}/${round}/${encoded}/${driver}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch laps (${res.status})`)
  return res.json()
}

export async function fetchChampionshipProgression(year) {
  const res = await fetch(`${BASE_URL}/championship-progression/${year}`)
  if (!res.ok) throw new Error(`Failed to fetch championship progression (${res.status})`)
  return res.json()
}

export async function fetchDriverStats(year) {
  const res = await fetch(`${BASE_URL}/driver-stats/${year}`)
  if (!res.ok) throw new Error(`Failed to fetch driver stats (${res.status})`)
  return res.json()
}

export async function fetchNextEvent(year) {
  const res = await fetch(`${BASE_URL}/next-event/${year}`)
  if (!res.ok) throw new Error(`Failed to fetch next event (${res.status})`)
  return res.json()
}

export async function fetchPredictions(year, round, force = false) {
  const url = `${BASE_URL}/predictions/${year}/${round}${force ? '?force=true' : ''}`
  const res = await fetch(url)
  if (!res.ok) throw await apiError(res, `Failed to fetch predictions (${res.status})`)
  return res.json()
}

export async function fetchDrivers(year, round, sessionName, eventDate) {
  const encoded = encodeURIComponent(sessionName)
  const params = eventDate ? `?event_date=${encodeURIComponent(eventDate)}` : ''
  const res = await fetch(`${BASE_URL}/drivers/${year}/${round}/${encoded}${params}`)
  if (!res.ok) throw new Error(`Failed to fetch drivers (${res.status})`)
  return res.json()
}
