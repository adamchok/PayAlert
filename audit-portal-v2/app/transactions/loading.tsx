import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/layout/AppShell'

export default function TransactionsLoading() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </AppShell>
  )
}
