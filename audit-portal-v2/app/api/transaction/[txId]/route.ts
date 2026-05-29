import type { NextRequest } from 'next/server'
import { getTransaction } from '@/lib/queries'
import { logger } from '@/lib/logger'

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/transaction/[txId]'>
) {
  const { txId } = await ctx.params

  try {
    const tx = await getTransaction(txId)
    if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(tx)
  } catch (err) {
    logger.error('[api/transaction] fetch failed', err)
    return Response.json({ error: 'Failed to fetch transaction' }, { status: 500 })
  }
}
