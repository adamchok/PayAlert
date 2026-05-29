import type { NextRequest } from 'next/server'
import { queryByDate } from '@/lib/queries'
import { todayMYT } from '@/lib/utils'
import { logger } from '@/lib/logger'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VALID_RISK = new Set(['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rawDate  = sp.get('date')   ?? todayMYT()
  const rawRisk  = sp.get('risk')   ?? 'ALL'
  const rawLimit = sp.get('limit')  ?? '50'
  const cursor   = sp.get('cursor') ?? undefined

  if (!DATE_RE.test(rawDate)) {
    return Response.json({ error: 'Invalid date format — expected YYYY-MM-DD' }, { status: 400 })
  }
  if (!VALID_RISK.has(rawRisk)) {
    return Response.json({ error: 'Invalid risk value' }, { status: 400 })
  }
  const limit = Math.min(Math.max(1, Number(rawLimit) || 50), 200)

  try {
    const { items, nextCursor } = await queryByDate(rawDate, rawRisk, limit, cursor)
    return Response.json({ items, nextCursor, count: items.length })
  } catch (err) {
    logger.error('[api/transactions] query failed', err)
    return Response.json({ error: 'Failed to query transactions' }, { status: 500 })
  }
}
