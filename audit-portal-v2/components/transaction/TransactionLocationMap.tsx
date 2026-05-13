'use client'

import dynamic from 'next/dynamic'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Transaction } from '@/lib/types'

const MapImpl = dynamic(() => import('./TransactionLocationMapImpl'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
})

interface TransactionLocationMapProps {
  tx: Transaction
}

export function TransactionLocationMap({ tx }: TransactionLocationMapProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Merchant Location</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="h-64 rounded-b-xl overflow-hidden">
          <MapImpl tx={tx} />
        </div>
      </CardContent>
    </Card>
  )
}
