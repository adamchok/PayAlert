import {
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs'
import { sqsClient, DLQ_URL, MAIN_QUEUE_URL } from '@/lib/sqs'
import type { DlqMessage } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET — return DLQ queue stats + up to 10 peeked messages.
// Messages are received with a 300s visibility window so the client
// has time to act on them before they reappear in the queue.
export async function GET() {
  if (!DLQ_URL) {
    return Response.json({ error: 'DLQ_URL is not configured' }, { status: 500 })
  }

  try {
    const [attrsRes, msgRes] = await Promise.all([
      sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: DLQ_URL,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
          ],
        })
      ),
      sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: DLQ_URL,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 300,
          AttributeNames: ['All'],
          MessageAttributeNames: ['All'],
          WaitTimeSeconds: 0,
        })
      ),
    ])

    const attrs = attrsRes.Attributes ?? {}
    const queueDepth = parseInt(attrs.ApproximateNumberOfMessages ?? '0', 10)
    const inFlight = parseInt(attrs.ApproximateNumberOfMessagesNotVisible ?? '0', 10)

    const messages: DlqMessage[] = (msgRes.Messages ?? []).map((m) => {
      const sentTs = m.Attributes?.SentTimestamp
      const sentAt = sentTs ? new Date(parseInt(sentTs, 10)).toISOString() : ''
      const receiveCount = parseInt(m.Attributes?.ApproximateReceiveCount ?? '1', 10)

      let body: DlqMessage['body'] = null
      try {
        body = JSON.parse(m.Body ?? '')
      } catch {
        body = null
      }

      return {
        messageId: m.MessageId ?? '',
        receiptHandle: m.ReceiptHandle ?? '',
        sentAt,
        receiveCount,
        body,
        rawBody: m.Body ?? '',
      }
    })

    return Response.json({ queueDepth, inFlight, messages })
  } catch (err) {
    console.error('[dlq GET]', err)
    return Response.json({ error: 'Failed to fetch DLQ' }, { status: 500 })
  }
}

// POST — redrive (send back to main queue + delete) or delete from DLQ.
export async function POST(request: Request) {
  if (!DLQ_URL) {
    return Response.json({ error: 'DLQ_URL is not configured' }, { status: 500 })
  }

  const { action, receiptHandle, rawBody } = await request.json() as {
    action: 'redrive' | 'delete'
    receiptHandle: string
    rawBody?: string
  }

  if (!receiptHandle) {
    return Response.json({ error: 'receiptHandle is required' }, { status: 400 })
  }

  try {
    if (action === 'redrive') {
      if (!MAIN_QUEUE_URL) {
        return Response.json({ error: 'MAIN_QUEUE_URL is not configured' }, { status: 500 })
      }
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
    }

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: DLQ_URL,
        ReceiptHandle: receiptHandle,
      })
    )

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[dlq POST]', err)
    return Response.json({ error: 'Action failed' }, { status: 500 })
  }
}
