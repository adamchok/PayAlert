import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { RiskLevel } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function todayMYT(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

export function dateNeighbors(dateStr: string, today: string): { prev: string; next: string; isToday: boolean } {
  const d = new Date(dateStr + 'T00:00:00Z')
  const prev = new Date(d)
  prev.setUTCDate(prev.getUTCDate() - 1)
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    prev: prev.toISOString().slice(0, 10),
    next: next.toISOString().slice(0, 10),
    isToday: dateStr === today,
  }
}

export function formatMYR(amount: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTime(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 'CRITICAL': return '#dc2626'
    case 'HIGH':     return '#f97316'
    case 'MEDIUM':   return '#eab308'
    case 'LOW':      return '#22c55e'
  }
}

export function getRiskScoreColor(score: number): string {
  if (score >= 80) return '#dc2626'
  if (score >= 60) return '#f97316'
  if (score >= 40) return '#eab308'
  return '#22c55e'
}

export function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-MY', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
