import type { NextRequest } from 'next/server'
import { queryByAccount } from '@/lib/queries'

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/account/[accountId]'>
) {
  const { accountId } = await ctx.params
  const date = request.nextUrl.searchParams.get('date') ?? undefined

  try {
    const items = await queryByAccount(accountId, date)
    const flagged = items.filter((tx) => tx.isFlagged).length
    return Response.json({ accountId, items, count: items.length, flagged })
  } catch (err) {
    console.error('[api/account]', err)
    return Response.json({ error: 'Failed to query account' }, { status: 500 })
  }
}
