import 'server-only'
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { docClient, TABLE_NAME } from './dynamo'
import { todayMYT } from './utils'
import type { Transaction } from './types'

const CURSOR_KEYS = new Set(['transactionId', 'datePartition', 'riskLevel', 'timestamp', 'accountId'])

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url')
}

function decodeCursor(cursor: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
  } catch {
    throw new Error('Malformed cursor')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Malformed cursor')
  }
  for (const key of Object.keys(parsed as object)) {
    if (!CURSOR_KEYS.has(key)) {
      throw new Error(`Invalid cursor key: ${key}`)
    }
  }
  return parsed as Record<string, unknown>
}

export async function queryByDate(
  dateStr: string,
  risk: string = 'ALL',
  limit: number = 50,
  cursor?: string
): Promise<{ items: Transaction[]; nextCursor: string | null }> {
  const startKey = cursor ? decodeCursor(cursor) : undefined

  if (risk !== 'ALL') {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'RiskLevelIndex',
        KeyConditionExpression: 'riskLevel = :rl AND begins_with(#ts, :date)',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':rl': risk, ':date': dateStr },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: startKey,
      })
    )
    return {
      items: (result.Items ?? []) as Transaction[],
      nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null,
    }
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DatePartitionIndex',
      KeyConditionExpression: 'datePartition = :dp',
      ExpressionAttributeValues: { ':dp': dateStr },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: startKey,
    })
  )
  return {
    items: (result.Items ?? []) as Transaction[],
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null,
  }
}

export async function queryByAccount(
  accountId: string,
  dateStr?: string,
  limit: number = 100
): Promise<Transaction[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'AccountTransactionsIndex',
      KeyConditionExpression: dateStr
        ? 'accountId = :aid AND begins_with(#ts, :date)'
        : 'accountId = :aid',
      ExpressionAttributeNames: dateStr ? { '#ts': 'timestamp' } : undefined,
      ExpressionAttributeValues: dateStr
        ? { ':aid': accountId, ':date': dateStr }
        : { ':aid': accountId },
      ScanIndexForward: false,
      Limit: limit,
    })
  )
  return (result.Items ?? []) as Transaction[]
}

export async function getTransaction(txId: string): Promise<Transaction | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { transactionId: txId },
    })
  )
  return (result.Item as Transaction) ?? null
}

export async function queryRecentTransactions(limit: number = 20): Promise<Transaction[]> {
  const todayDate = todayMYT()
  const datePartitions = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    return d.toISOString().slice(0, 10)
  })

  const responses = await Promise.all(
    datePartitions.map(dateStr =>
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'DatePartitionIndex',
          KeyConditionExpression: 'datePartition = :dp',
          ExpressionAttributeValues: { ':dp': dateStr },
          ScanIndexForward: false,
          Limit: limit,
        })
      )
    )
  )

  return responses
    .flatMap(resp => (resp.Items ?? []) as Transaction[])
    .sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0))
    .slice(0, limit)
}

export async function queryLastNDays(n: number): Promise<{ date: string; count: number }[]> {
  const today = todayMYT()
  const dates = Array.from({ length: n }, (_, i) => {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    return d.toISOString().slice(0, 10)
  })

  const BATCH = 5
  const results: { date: string; count: number }[] = []
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH)
    const batchResults = await Promise.all(
      batch.map(async (date) => {
        const resp = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'DatePartitionIndex',
            KeyConditionExpression: 'datePartition = :dp',
            ExpressionAttributeValues: { ':dp': date },
            Select: 'COUNT',
          })
        )
        return { date, count: resp.Count ?? 0 }
      })
    )
    results.push(...batchResults)
  }
  return results.reverse()
}
