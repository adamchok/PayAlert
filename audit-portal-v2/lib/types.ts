export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface Transaction {
  transactionId: string
  timestamp: string
  datePartition: string
  accountId: string
  customerId?: string
  customerName?: string
  customerTier?: string
  cardType?: string
  cardLast4?: string
  amount: number
  currency: string
  amountMYR: number
  exchangeRate?: number
  transactionType?: string
  channel?: string
  merchantName?: string
  merchantId?: string
  merchantCategory?: string
  merchantCity?: string
  merchantState?: string
  merchantCountry?: string
  description?: string
  referenceId?: string
  riskScore: number
  riskLevel: RiskLevel
  isFlagged: boolean
  flagReason?: string
  riskFlags?: string[]
  fraudScenario?: string
  processedAt?: string
  generatorVersion?: string
}

export interface DashboardStats {
  total: number
  flagged: number
  byRisk: Record<RiskLevel, number>
  byChannel: Record<string, number>
  items: Transaction[]
  date: string
  prevDate: string
  nextDate: string
  today: string
}

export interface DlqMessage {
  transactionId: string
  failedAt: string
  receiveCount: number
  body: Partial<Transaction> | null
  rawBody: string
}

export interface AccountSummary {
  accountId: string
  customerName?: string
  customerTier?: string
  customerId?: string
  cardType?: string
  cardLast4?: string
  total: number
  flagged: number
  items: Transaction[]
}
