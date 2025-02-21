import { SentimentError } from './errors'
import { RetryOptions, RecoveryResult, ErrorMetadata } from './types'
import pino from 'pino'

const logger = pino({ name: 'SentimentErrorRecovery' })

export class ErrorRecovery {
  constructor(private readonly service: string) {}

  async attemptRecovery(
    error: SentimentError,
    operation: () => Promise<any>
  ): Promise<RecoveryResult> {
    if (!error.shouldRetry) {
      return {
        success: false,
        error,
        metadata: this.createErrorMetadata(error, 'no_retry')
      }
    }

    const options = error.retryOptions as RetryOptions
    let currentAttempt = 1

    while (currentAttempt <= options.maxAttempts) {
      try {
        logger.info({
          attempt: currentAttempt,
          maxAttempts: options.maxAttempts,
          error: error.message
        }, 'Attempting recovery')

        // Exponential backoff
        const backoff = options.backoffMs * Math.pow(2, currentAttempt - 1)
        await this.sleep(backoff)

        // Attempt operation
        await operation()

        logger.info({
          attempt: currentAttempt,
          error: error.message
        }, 'Recovery successful')

        return {
          success: true,
          metadata: this.createErrorMetadata(error, 'recovered', { attempts: currentAttempt })
        }
      } catch (retryError) {
        currentAttempt++
        
        if (currentAttempt > options.maxAttempts) {
          logger.error({
            error: retryError,
            originalError: error,
            attempts: currentAttempt
          }, 'Recovery failed, max attempts reached')

          return {
            success: false,
            error: retryError as Error,
            metadata: this.createErrorMetadata(error, 'max_attempts', {
              attempts: currentAttempt,
              finalError: retryError
            })
          }
        }
      }
    }

    // This should never happen due to the while loop condition
    return {
      success: false,
      error,
      metadata: this.createErrorMetadata(error, 'unknown')
    }
  }

  private createErrorMetadata(
    error: SentimentError,
    status: string,
    additional: Record<string, any> = {}
  ): ErrorMetadata {
    return {
      timestamp: Date.now(),
      service: this.service,
      operation: error.code,
      status,
      severity: error.severity,
      ...additional
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
} 