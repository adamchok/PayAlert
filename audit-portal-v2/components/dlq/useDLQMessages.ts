'use client'

import { useState, useCallback, useEffect } from 'react'
import type { DlqMessage } from '@/lib/types'

export interface DLQData {
  messages: DlqMessage[]
  nextCursor?: string
  error?: string
}

export interface RowState {
  loading: boolean
  done: boolean
  error: string | null
}

export function useDLQMessages() {
  const [data, setData] = useState<DLQData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/dlq', { cache: 'no-store' })
      const json: DLQData = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setRowState({})
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load DLQ')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/dlq?cursor=${encodeURIComponent(data.nextCursor)}`, { cache: 'no-store' })
      const json: DLQData = await res.json()
      if (json.error) throw new Error(json.error)
      setData(prev => prev
        ? { ...json, messages: [...prev.messages, ...json.messages] }
        : json
      )
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }, [data?.nextCursor])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const handleAction = useCallback(async (action: 'redrive' | 'delete', msg: DlqMessage) => {
    setRowState(s => ({ ...s, [msg.transactionId]: { loading: true, done: false, error: null } }))
    try {
      const res = await fetch('/api/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, transactionId: msg.transactionId, rawBody: msg.rawBody }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')
      setRowState(s => ({ ...s, [msg.transactionId]: { loading: false, done: true, error: null } }))
      setTimeout(() => {
        setData(prev =>
          prev ? { ...prev, messages: prev.messages.filter(m => m.transactionId !== msg.transactionId) } : prev
        )
      }, 800)
    } catch (e) {
      setRowState(s => ({
        ...s,
        [msg.transactionId]: { loading: false, done: false, error: e instanceof Error ? e.message : 'Failed' },
      }))
    }
  }, [])

  return { data, fetchError, loading, loadingMore, rowState, fetchMessages, loadMore, handleAction }
}
