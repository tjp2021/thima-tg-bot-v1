import { RetryOptions } from './types'

export enum ErrorCode {
  INITIALIZATION = 'INIT_ERROR',
  EMBEDDING = 'EMBEDDING_ERROR',
  VECTOR_STORE = 'VECTOR_STORE_ERROR',
  CACHE = 'CACHE_ERROR',
  ANALYSIS = 'ANALYSIS_ERROR',
  RATE_LIMIT = 'RATE_LIMIT_ERROR'
}

export enum ErrorSeverity {
  LOW = 'LOW',        // Minor issues, can continue
  MEDIUM = 'MEDIUM',  // Significant issues, but recoverable
  HIGH = 'HIGH',      // Severe issues, needs immediate attention
  CRITICAL = 'CRITICAL' // System cannot function
}

export abstract class SentimentError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly severity: ErrorSeverity,
    public readonly retryable: boolean,
    public readonly retryOptions?: RetryOptions,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'SentimentError'
    Error.captureStackTrace(this, this.constructor)
  }

  public get shouldRetry(): boolean {
    return this.retryable && !!this.retryOptions
  }
}

export class InitializationError extends SentimentError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      ErrorCode.INITIALIZATION,
      ErrorSeverity.HIGH,
      true,
      { maxAttempts: 3, backoffMs: 1000 },
      cause
    )
    this.name = 'InitializationError'
  }
}

export class EmbeddingError extends SentimentError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      ErrorCode.EMBEDDING,
      ErrorSeverity.MEDIUM,
      true,
      { maxAttempts: 5, backoffMs: 500 },
      cause
    )
    this.name = 'EmbeddingError'
  }
}

export class VectorStoreError extends SentimentError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      ErrorCode.VECTOR_STORE,
      ErrorSeverity.MEDIUM,
      true,
      { maxAttempts: 3, backoffMs: 1000 },
      cause
    )
    this.name = 'VectorStoreError'
  }
}

export class CacheError extends SentimentError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      ErrorCode.CACHE,
      ErrorSeverity.LOW,
      true,
      { maxAttempts: 2, backoffMs: 200 },
      cause
    )
    this.name = 'CacheError'
  }
}

export class AnalysisError extends SentimentError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      ErrorCode.ANALYSIS,
      ErrorSeverity.MEDIUM,
      true,
      { maxAttempts: 3, backoffMs: 500 },
      cause
    )
    this.name = 'AnalysisError'
  }
}

export class RateLimitError extends SentimentError {
  constructor(message: string, retryAfterMs: number, cause?: Error) {
    super(
      message,
      ErrorCode.RATE_LIMIT,
      ErrorSeverity.LOW,
      true,
      { maxAttempts: 1, backoffMs: retryAfterMs },
      cause
    )
    this.name = 'RateLimitError'
  }
} 