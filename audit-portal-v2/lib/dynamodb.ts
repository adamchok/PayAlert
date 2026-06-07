import 'server-only'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
})

export const dynamoClient = DynamoDBDocumentClient.from(client)

export const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE ?? ''
export const FAILED_TRANSACTIONS_INDEX = 'FailedTransactionsIndex'
