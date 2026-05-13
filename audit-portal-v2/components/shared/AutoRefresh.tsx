'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

interface AutoRefreshProps {
  intervalMs?: number
}

export function AutoRefresh({ intervalMs = 30000 }: AutoRefreshProps) {
  const router = useRouter()
  const [countdown, setCountdown] = useState(Math.floor(intervalMs / 1000))
  const [refreshing, setRefreshing] = useState(false)
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setCountdown(Math.floor(intervalMs / 1000))

    const tick = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000))
      setCountdown(remaining)

      if (elapsed >= intervalMs) {
        setRefreshing(true)
        router.refresh()
        startRef.current = Date.now()
        setCountdown(Math.floor(intervalMs / 1000))
        setTimeout(() => setRefreshing(false), 600)
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [router, intervalMs])

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
      <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
      {refreshing ? 'Refreshing…' : `Refreshes in ${countdown}s`}
    </span>
  )
}
