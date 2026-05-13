import type { NextRequest } from 'next/server'
import { queryByDate } from '@/lib/queries'
import { todayMYT } from '@/lib/utils'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const date   = sp.get('date')   ?? todayMYT()
  const risk   = sp.get('risk')   ?? 'ALL'
  const limit  = Math.min(Number(sp.get('limit') ?? '50'), 200)
  const cursor = sp.get('cursor') ?? undefined

  try {
    const { items, nextCursor } = await queryByDate(date, risk, limit, cursor)
    return Response.json({ items, nextCursor, count: items.length })
  } catch (err) {
    console.error('[api/transactions]', err)
    return Response.json({ error: 'Failed to query transactions' }, { status: 500 })
  }
}
