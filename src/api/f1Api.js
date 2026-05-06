const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function fetchSchedule(year) {
  const res = await fetch(`${BASE_URL}/schedule/${year}`)
  if (!res.ok) throw new Error(`Failed to fetch ${year} schedule (${res.status})`)
  return res.json()
}

export async function fetchSessions(year, round) {
  const res = await fetch(`${BASE_URL}/sessions/${year}/${round}`)
  if (!res.ok) throw new Error(`Failed to fetch sessions (${res.status})`)
  return res.json()
}

export async function fetchResults(year, round, sessionName) {
  const encoded = encodeURIComponent(sessionName)
  const res = await fetch(`${BASE_URL}/results/${year}/${round}/${encoded}`)
  if (!res.ok) throw new Error(`Failed to fetch results (${res.status})`)
  return res.json()
}
