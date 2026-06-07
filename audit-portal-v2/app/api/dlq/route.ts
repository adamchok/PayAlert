import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { dynamoClient, DYNAMODB_TABLE, FAILED_TRANSACTIONS_INDEX } from '@/lib/dynamodb'
import { sqsClient, MAIN_QUEUE_URL } from '@/lib/sqs'
import type { DlqMessage } from '@/lib/types'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// GET — query FailedTransactionsIndex for processingStatus="failed" records.
// Returns newest-first, 50 per page. Pass ?cursor=<token> for subsequent pages.
export async function GET(request: Request) {
  if (!DYNAMODB_TABLE) {
    return Response.json({ error: 'DYNAMODB_TABLE is not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const cursorParam = searchParams.get('cursor')
  let exclusiveStartKey: Record<string, unknown> | undefined
  if (cursorParam) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(cursorParam, 'base64').toString('utf8'))
    } catch {
      return Response.json({ error: 'Invalid cursor' }, { status: 400 })
    }
  }

  try {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: DYNAMODB_TABLE,
        IndexName: FAILED_TRANSACTIONS_INDEX,
        KeyConditionExpression: 'processingStatus = :s',
        ExpressionAttributeValues: { ':s': 'failed' },
        ScanIndexForward: false,
        Limit: 50,
        ExclusiveStartKey: exclusiveStartKey,
      })
    )

    const messages: DlqMessage[] = (result.Items ?? []).map((item) => ({
      transactionId: item.transactionId ?? '',
      failedAt: item.failedAt ?? '',
      receiveCount: item.receiveCount ?? 1,
      body: item.transactionId ? (item as unknown as DlqMessage['body']) : null,
      rawBody: item.rawBody ?? '',
    }))

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined

    return Response.json({ messages, nextCursor })
  } catch (err) {
    logger.error('[dlq GET] fetch failed', err)
    return Response.json({ error: 'Failed to fetch failed transactions' }, { status: 500 })
  }
}

// POST — redrive (send back to main queue) or delete (mark discarded) a failed transaction.
export async function POST(request: Request) {
  if (!DYNAMODB_TABLE) {
    return Response.json({ error: 'DYNAMODB_TABLE is not configured' }, { status: 500 })
  }

  const { action, transactionId, rawBody } = await request.json() as {
    action: 'redrive' | 'delete'
    transactionId: string
    rawBody?: string
  }

  if (!transactionId) {
    return Response.json({ error: 'transactionId is required' }, { status: 400 })
  }
  if (action !== 'redrive' && action !== 'delete') {
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    if (action === 'redrive') {
      if (!MAIN_QUEUE_URL) {
        return Response.json({ error: 'MAIN_QUEUE_URL is not configured' }, { status: 500 })
      }
      // Strip _forceFail so the message processes successfully on retry
      let messageBody = rawBody ?? ''
      try {
        const parsed = JSON.parse(messageBody)
        if (parsed._forceFail) {
          delete parsed._forceFail
          messageBody = JSON.stringify(parsed)
        }
      } catch { /* send as-is if body isn't valid JSON */ }

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: MAIN_QUEUE_URL,
          MessageBody: messageBody,
        })
      )
      // DynamoDB record is healed automatically when the main processor rewrites it
      // without processingStatus (ConditionExpression allows overwrite of failed records).
    } else {
      // Mark discarded — removed from the failed GSI query, record is preserved
      await dynamoClient.send(
        new UpdateCommand({
          TableName: DYNAMODB_TABLE,
          Key: { transactionId },
          UpdateExpression: 'SET processingStatus = :d',
          ExpressionAttributeValues: { ':d': 'discarded' },
        })
      )
    }

    return Response.json({ ok: true })
  } catch (err) {
    logger.error('[dlq POST] action failed', err)
    return Response.json({ error: 'Action failed' }, { status: 500 })
  }
}
