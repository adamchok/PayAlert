import 'server-only'
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { docClient, TABLE_NAME } from './dynamo'
import { todayMYT } from './utils'
import type { Transaction } from './types'

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url')
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
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

export async function queryLastNDays(n: number): Promise<{ date: string; count: number }[]> {
  const today = todayMYT()
  const dates = Array.from({ length: n }, (_, i) => {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    return d.toISOString().slice(0, 10)
  })

  const results = await Promise.all(
    dates.map(async (date) => {
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
  return results.reverse()
}
