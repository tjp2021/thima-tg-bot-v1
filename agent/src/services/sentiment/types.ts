export interface RetryOptions {
  maxAttempts: number
  backoffMs: number
  currentAttempt?: number
}

export interface ErrorMetadata {
  timestamp: number
  service: string
  operation: string
  result?: any // The result of a successful recovery
  status?: string
  severity?: string
  attempts?: number
  finalError?: Error
  [key: string]: any
}

export interface RecoveryResult {
  success: boolean
  error?: Error
  metadata?: ErrorMetadata
}

export interface SentimentCacheEntry {
  messageHash: string
  embedding: string
  sentiment: string
  confidence: number
  context: string
  userId: string
  roomId: string
  senderName: string
  createdAt: Date
  expiresAt: Date
} 