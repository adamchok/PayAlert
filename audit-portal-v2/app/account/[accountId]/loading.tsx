import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/layout/AppShell'

export default function AccountLoading() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </AppShell>
  )
}
