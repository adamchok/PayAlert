import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { Card, CardContent } from '@/components/ui/card'
import { DLQTable } from '@/components/dlq/DLQTable'
import { sqsClient, DLQ_URL } from '@/lib/sqs'
import { AlertTriangle, Inbox, Activity, Clock } from 'lucide-react'

async function getDLQStats() {
  if (!DLQ_URL) return null
  try {
    const res = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: DLQ_URL,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'CreatedTimestamp',
        ],
      })
    )
    const attrs = res.Attributes ?? {}
    return {
      depth: parseInt(attrs.ApproximateNumberOfMessages ?? '0', 10),
      inFlight: parseInt(attrs.ApproximateNumberOfMessagesNotVisible ?? '0', 10),
    }
  } catch {
    return null
  }
}

export default async function DLQPage() {
  const stats = await getDLQStats()

  const statCards = [
    {
      label: 'Messages in DLQ',
      value: stats?.depth ?? '—',
      icon: Inbox,
      color: 'text-red-400',
      border: 'border-l-red-600',
      note: 'Awaiting review',
    },
    {
      label: 'In Flight',
      value: stats?.inFlight ?? '—',
      icon: Activity,
      color: 'text-orange-400',
      border: 'border-l-orange-500',
      note: 'Currently locked',
    },
    {
      label: 'Max Retries',
      value: 3,
      icon: AlertTriangle,
      color: 'text-yellow-400',
      border: 'border-l-yellow-500',
      note: 'Before DLQ routing',
    },
    {
      label: 'Lock Window',
      value: '5 min',
      icon: Clock,
      color: 'text-blue-400',
      border: 'border-l-blue-500',
      note: 'To redrive or delete',
    },
  ]

  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Dead Letter Queue</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            Transactions that failed processing after 3 attempts. Redrive to reprocess or delete to discard.
          </p>
        </div>

        {!DLQ_URL && (
          <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
            <strong>DLQ_URL</strong> is not set in <code>.env.local</code>. Add it to enable DLQ monitoring.
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(({ label, value, icon: Icon, color, border, note }) => (
            <Card key={label} className={`border-l-4 ${border}`}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
                    {label}
                  </p>
                  <p className="text-3xl font-bold text-[var(--foreground)] mt-1">{value}</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{note}</p>
                </div>
                <Icon className={`h-8 w-8 opacity-70 ${color}`} />
              </CardContent>
            </Card>
          ))}
        </div>

        <DLQTable />
      </div>
    </AppShell>
  )
}
