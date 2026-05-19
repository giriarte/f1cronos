import { useState, useEffect, useRef, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export function useWebSocket() {
  const [status, setStatus] = useState('disconnected')
  const [sessionInfo, setSessionInfo] = useState(null)
  const [currentSegment, setCurrentSegment] = useState(null)
  const [segmentData, setSegmentData] = useState({})
  const [sessionTime, setSessionTime] = useState(null)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)
  const closingRef = useRef(false)

  const connect = useCallback(({ year, round, session, mode, speed }) => {
    if (wsRef.current) {
      closingRef.current = true
      wsRef.current.close()
      wsRef.current = null
    }

    closingRef.current = false
    setStatus('connecting')
    setSessionInfo(null)
    setCurrentSegment(null)
    setSegmentData({})
    setSessionTime(null)
    setError(null)

    const url = mode === 'live'
      ? `${WS_BASE}/ws/live`
      : `${WS_BASE}/ws/live-replay?year=${year}&round_number=${round}&session_name=${encodeURIComponent(session)}&speed=${speed}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setStatus('connected')

    ws.onmessage = (evt) => {
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }

      switch (msg.type) {
        case 'session_info':
          setSessionInfo(msg)
          setCurrentSegment(msg.segments[0])
          break
        case 'segment_change':
          setCurrentSegment(msg.segment)
          break
        case 'timing_update':
          setSegmentData(prev => ({ ...prev, [msg.segment]: msg }))
          setSessionTime(msg.sessionTime)
          break
        case 'session_end':
          setStatus('ended')
          break
        case 'error':
          setError(msg.detail)
          setStatus('error')
          break
        default:
          break
      }
    }

    ws.onerror = () => {
      setError('WebSocket connection error')
      setStatus('error')
    }

    ws.onclose = () => {
      if (!closingRef.current) {
        setStatus(s => (s === 'ended' || s === 'error') ? s : 'disconnected')
      }
    }
  }, [])

  const disconnect = useCallback(() => {
    closingRef.current = true
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  useEffect(() => () => {
    closingRef.current = true
    wsRef.current?.close()
  }, [])

  return { status, sessionInfo, currentSegment, segmentData, sessionTime, error, connect, disconnect }
}
