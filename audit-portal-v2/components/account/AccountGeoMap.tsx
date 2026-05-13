'use client'

import dynamic from 'next/dynamic'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Transaction } from '@/lib/types'

const MapImpl = dynamic(() => import('./AccountGeoMapImpl'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
})

interface AccountGeoMapProps {
  items: Transaction[]
}

export function AccountGeoMap({ items }: AccountGeoMapProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Transaction Locations</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="h-64 rounded-b-xl overflow-hidden">
          <MapImpl items={items} />
        </div>
      </CardContent>
    </Card>
  )
}
