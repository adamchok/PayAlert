import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { Card, CardContent } from '@/components/ui/card'
import { DLQTable } from '@/components/dlq/DLQTable'
import { dynamoClient, DYNAMODB_TABLE, FAILED_TRANSACTIONS_INDEX } from '@/lib/dynamodb'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

async function getFailedCount(): Promise<number> {
  if (!DYNAMODB_TABLE) return 0
  try {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: DYNAMODB_TABLE,
        IndexName: FAILED_TRANSACTIONS_INDEX,
        KeyConditionExpression: 'processingStatus = :s',
        ExpressionAttributeValues: { ':s': 'failed' },
        Select: 'COUNT',
      })
    )
    return res.Count ?? 0
  } catch {
    return 0
  }
}

export default async function DLQPage() {
  const failedCount = await getFailedCount()

  const statCards = [
    {
      label: 'Failed Transactions',
      value: failedCount,
      icon: Inbox,
      color: 'text-red-400',
      border: 'border-l-red-600',
      note: 'Awaiting review',
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
      label: 'DLQ Retention',
      value: '14 days',
      icon: RefreshCw,
      color: 'text-blue-400',
      border: 'border-l-blue-500',
      note: 'SQS message window',
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

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
