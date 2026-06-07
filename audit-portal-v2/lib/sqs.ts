import 'server-only'
import { SQSClient } from '@aws-sdk/client-sqs'

export const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
})

export const MAIN_QUEUE_URL = process.env.MAIN_QUEUE_URL ?? ''
