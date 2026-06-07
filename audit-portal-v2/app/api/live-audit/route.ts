import { NextResponse } from 'next/server'
import { queryRecentTransactions } from '@/lib/queries'

export async function GET() {
  try {
    const transactions = await queryRecentTransactions(20)
    return NextResponse.json({ transactions })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch transactions' },
      { status: 500 }
    )
  }
}
