'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { DlqMessage } from '@/lib/types'

export interface FailedTransactionsData {
  messages: DlqMessage[]
  nextCursor?: string
  error?: string
}

export interface RowState {
  loading: boolean
  done: boolean
  error: string | null
}

export function useFailedTransactions() {
  const [data, setData] = useState<FailedTransactionsData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const removeTimeouts = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => { removeTimeouts.current.forEach(clearTimeout) }
  }, [])

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/failed-transactions', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const json: FailedTransactionsData = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      // Preserve in-flight row states so active spinners survive a refresh
      setRowState(s => {
        const next: Record<string, RowState> = {}
        for (const [id, state] of Object.entries(s)) {
          if (state.loading) next[id] = state
        }
        return next
      })
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load failed transactions')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/failed-transactions?cursor=${encodeURIComponent(data.nextCursor)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const json: FailedTransactionsData = await res.json()
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
      const res = await fetch('/api/failed-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, transactionId: msg.transactionId, rawBody: msg.rawBody }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error((errJson as { error?: string }).error ?? `Server error: ${res.status}`)
      }
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')
      setRowState(s => ({ ...s, [msg.transactionId]: { loading: false, done: true, error: null } }))
      const t = setTimeout(() => {
        setData(prev =>
          prev ? { ...prev, messages: prev.messages.filter(m => m.transactionId !== msg.transactionId) } : prev
        )
      }, 800)
      removeTimeouts.current.push(t)
    } catch (e) {
      setRowState(s => ({
        ...s,
        [msg.transactionId]: { loading: false, done: false, error: e instanceof Error ? e.message : 'Failed' },
      }))
    }
  }, [])

  return { data, fetchError, loading, loadingMore, rowState, fetchMessages, loadMore, handleAction }
}
