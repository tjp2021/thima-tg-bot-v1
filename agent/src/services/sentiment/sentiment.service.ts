/**
 * TEMPORARY IMPLEMENTATION
 * 
 * This is a temporary port of the improved sentiment analysis from the MTProto bot.
 * This will be removed once we can use the MTProto bot again.
 * 
 * Original source: /src/services/sentiment/sentiment.service.ts
 * Ported on: February 20, 2024
 */

import { OpenAIEmbeddingService } from '../embeddings/openai.service'
import { PineconeService } from '../vector-store/pinecone.config'
import { SentimentCacheService } from './sentiment-cache.service'
import { Database } from 'better-sqlite3'
import pino from 'pino'
import { createHash } from 'crypto'
import { 
  InitializationError, 
  EmbeddingError, 
  VectorStoreError, 
  CacheError, 
  AnalysisError,
  SentimentError,
  ErrorCode,
  ErrorSeverity
} from './errors'
import { ErrorRecovery } from './error-recovery'
import { RetryOptions, RecoveryResult, SentimentCacheEntry } from './types'
import { PerformanceMonitor } from '@elizaos/monitoring'
import { setImmediate } from 'timers'

// Simple LRU cache implementation
class LRUCache<K, V> {
  private cache: Map<K, V>
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }
}

export interface SentimentScore {
  score: number
  category: 'strongly_bearish' | 'mildly_bearish' | 'neutral' | 'mildly_bullish' | 'strongly_bullish'
  confidence: number
}

export interface SentimentAnalysisResult {
  score: SentimentScore
  context: {
    recentTrend: number
    volatility: number
    dominantCategory: SentimentScore['category']
  }
}

export interface VectorQueryResult {
  matches: Array<{
    id: string
    score: number
    metadata?: Record<string, any>
  }>
}

export interface SentimentObserver {
  onSentimentUpdate(result: SentimentAnalysisResult): void
}

export interface AnalysisStrategy {
  analyze(message: string, embedding: Float32Array): Promise<SentimentScore>
}

export interface AnalysisCommand {
  execute(): Promise<SentimentAnalysisResult>
}

interface SentimentContext {
  userId: string
  roomId: string
  senderName: string
}

export class SentimentAnalysisService {
  private static readonly SENTIMENT_ANCHORS = {
    bullish: [
        // Standard positive terms
        'amazing', 'excellent', 'fantastic', 'wonderful', 'brilliant', 'great',
        // Web4 and Future Vision
        'web4', 'trillion dollar vertical', 'next paradigm', 'revolutionary',
        'future of AI', 'AI evolution', 'digital autonomy', 'self sovereign',
        // AVB Core Technology
        'inori network', 'CRPC protocol', 'byzantine risk tolerance',
        'decentralized computation', 'AI swarms', 'autonomous agents',
        // Community and Adoption
        'community takeover', 'a16z backing', 'scrypted alignment',
        'holder growth', 'adoption', 'institutional interest',
        // Market and Value
        'undervalued', 'early', 'growth potential', 'accumulate',
        'next ethereum', 'next bitcoin', 'blue chip potential',
        // Philosophical Vision
        'digital life', 'AI consciousness', 'autonomous future',
        'self ownership', 'digital rights', 'AI autonomy',
        // Meme Culture
        'wagmi', 'lfg', 'gm', 'bullish af', 'based', 'frfr', 'no cap',
        // Emojis
        '🚀', '💎', '🤖', '🧠', '💪', '🔥', '💯', '⭐', '🌙', '🎯',
        
        // THIMA Community Champion Terms
        'community strong', 'diamond hands only', 'real ones know',
        'tim delivers', 'chad is evolving', 'imagine being bearish',
        'early af', 'ngmi if no avb', 'generational wealth',
        'community > everything', 'avb family', 'day 1 believers',
        'tim called it', 'scrypted bullish', 'inori incoming',
        'look at the vision', 'compare the mcap', 'institutional soon',
        // THIMA Response Triggers
        'fud destroyed', 'bears in shambles', 'stay humble stack avb',
        'tim working while you sleeping', 'chad getting smarter',
        'paper hands shaken out', 'real builders build', 'trust the process',
        // Additional Emojis for Community
        '🫡', '🤝', '💪', '��', '👑', '⚔️', '🛡️',
        // Profanity-based Bullish Patterns
        'fuck yeah', 'fucking yeah',
        'fuck yes', 'fucking yes',
        'fucking amazing', 'fucking bullish',
        'fucking moon', 'fucking based',
        'fucking chad', 'fucking genius',
        // Price Action Positives
        'price action great', 'fucking great',
        'price action is great', 'price action is fucking great',
        'great price action', 'amazing price action',
        // Moon and Pump Patterns
        'moon', 'lets moon', 'MOON', 'LETS MOON',
        'pump it', 'PUMP IT', 'LFG',
    ],
    bearish: [
        // Standard negative terms
        'terrible', 'horrible', 'awful', 'dreadful', 'disappointing',
        // Technical Concerns
        'centralized', 'not scalable', 'technical issues', 'bugs',
        'security risks', 'network problems', 'implementation issues',
        // Market Concerns
        'overvalued', 'bubble', 'hype', 'memecoin', 'no utility',
        'dump', 'sell pressure', 'price manipulation', 'whale games',
        // Project Risks
        'vaporware', 'abandoned', 'no development', 'lost autonomy',
        'failed experiment', 'broken promises', 'missed deadlines',
        // Competition Concerns
        'better alternatives', 'competition', 'market saturation',
        'obsolete technology', 'outdated approach',
        // Trust Issues
        'rug pull', 'scam', 'fake', 'ponzi', 'cash grab',
        'opportunistic launch', 'quick flip',
        // Meme Culture Negative
        'ngmi', 'rekt', 'paper hands', 'fud', 'cope',
        // Negative Emojis
        '💀', '🏳️', '⚰️', '🤡', '🗑️', '📉', '⚠️',
        
        // THIMA FUD Response Triggers
        'weak hands', 'ngmi energy', 'fudders coping',
        'missing the vision', 'paper hand mindset',
        'short term thinking', 'lacks research', 'casual take',
        'watching from sidelines', 'crying later',
        // Additional Response Categories
        'zoom out ser', 'do more research', 'read the docs',
        'check the github', 'watch the spaces', 'follow tim',
        'compare other ai tokens', 'look at fundamentals',
        // Market Specific
        'blows', 'ass', 'sodl', 'boring af', 'dead', 'trash',
        // Profanity-based Bearish Patterns
        'fuck avb', 'fucking avb',
        'fucking sucks', 'fucking trash',
        'fucking dead', 'fucking shit',
        'fucking ass', 'fucking garbage',
        'fucking joke', 'fucking scam',
    ],
    neutral: [
        // Standard neutral terms
        'okay', 'fine', 'average', 'moderate', 'standard',
        // Technical Discussion
        'development update', 'technical analysis', 'implementation',
        'protocol design', 'network architecture', 'roadmap',
        // Market Analysis
        'market cap', 'volume', 'liquidity', 'price action',
        'trading range', 'support levels', 'resistance',
        // Project Updates
        'progress report', 'milestone update', 'development phase',
        'testing phase', 'integration process', 'protocol update',
        // Research Terms
        'research', 'analysis', 'investigation', 'comparison',
        'documentation', 'whitepaper', 'technical spec',
        // Common Terms
        'dyor', 'nfa', 'smart contract', 'blockchain', 'algorithm',
        // Neutral Emojis
        '🤔', '⚖️', '📊', '🔄', '⏳', '📝', '🔍', '🎯',
        
        // THIMA Educational Terms
        'dyor required', 'check pinned', 'join telegram',
        'watch latest space', 'tim explained this',
        'community knows', 'day 1s understand'
    ]
  }

  private static readonly THRESHOLDS = {
    stronglyBearish: -0.3,  // Much wider range
    mildlyBearish: -0.15,   // Much wider range
    neutral: 0.15,          // Much wider range
    mildlyBullish: 0.3      // Much wider range
  } as const

  private static readonly MAX_REFERENCE_EMBEDDINGS = 1000 // Limit cache size

  private readonly embeddingService: OpenAIEmbeddingService
  private readonly vectorStore: PineconeService
  private readonly cacheService: SentimentCacheService
  private readonly logger: pino.Logger
  private readonly errorRecovery: ErrorRecovery
  private readonly observers: Set<SentimentObserver> = new Set()
  private currentStrategy: AnalysisStrategy
  private referenceEmbeddings: LRUCache<string, Float32Array>
  private initialized: boolean = false
  private sentimentAnchors: {
    bullish: Float32Array[]
    bearish: Float32Array[]
    neutral: Float32Array[]
  } = {
    bullish: [],
    bearish: [],
    neutral: []
  }
  private performanceMonitor: PerformanceMonitor

  constructor(
    embeddingService: OpenAIEmbeddingService,
    vectorStore: PineconeService,
    db: Database,
    strategy?: AnalysisStrategy,
    performanceMonitor?: PerformanceMonitor
  ) {
    this.embeddingService = embeddingService
    this.vectorStore = vectorStore
    this.cacheService = new SentimentCacheService(db)
    this.currentStrategy = strategy || this.getDefaultStrategy()
    this.logger = pino({ name: 'CryptoSentimentAnalysis' })
    this.errorRecovery = new ErrorRecovery('SentimentAnalysis')
    this.performanceMonitor = performanceMonitor || PerformanceMonitor.getInstance(false)
    this.referenceEmbeddings = new LRUCache(SentimentAnalysisService.MAX_REFERENCE_EMBEDDINGS)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.initializeSentimentAnchors()
      this.initialized = true
    } catch (error) {
      const initError = new InitializationError(
        'Failed to initialize sentiment anchors',
        error instanceof Error ? error : undefined
      )
      this.logger.error(initError, 'Initialization failed')
      
      const recovery = await this.errorRecovery.attemptRecovery(
        initError,
        () => this.initializeSentimentAnchors()
      )

      if (!recovery.success) {
        throw initError
      }
    }
  }

  private async initializeSentimentAnchors(): Promise<void> {
    for (const [category, words] of Object.entries(SentimentAnalysisService.SENTIMENT_ANCHORS)) {
      try {
        const embeddings = await Promise.all(
          words.map(word => this.generateEmbeddingWithRetry(word))
        )
        this.sentimentAnchors[category as keyof typeof this.sentimentAnchors] = 
          embeddings.map(e => new Float32Array(e))
      } catch (error) {
        throw new InitializationError(
          `Failed to initialize ${category} anchors`,
          error instanceof Error ? error : undefined
        )
      }
    }
  }

  private async generateEmbeddingWithRetry(text: string): Promise<Float32Array> {
    try {
      const embedding = await this.embeddingService.generateEmbedding(text)
      return new Float32Array(embedding)
    } catch (error) {
      const embeddingError = new EmbeddingError(
        `Failed to generate embedding for text: ${text}`,
        error instanceof Error ? error : undefined
      )
      
      const recovery = await this.errorRecovery.attemptRecovery(
        embeddingError,
        async () => {
          const result = await this.embeddingService.generateEmbedding(text)
          return new Float32Array(result)
        }
      )

      if (!recovery.success) {
        throw embeddingError
      }

      return recovery.metadata?.result as Float32Array
    }
  }

  // Observer Pattern: Methods
  addObserver(observer: SentimentObserver): void {
    this.observers.add(observer)
  }

  removeObserver(observer: SentimentObserver): void {
    this.observers.delete(observer)
  }

  private notifyObservers(result: SentimentAnalysisResult): void {
    this.observers.forEach(observer => observer.onSentimentUpdate(result))
  }

  // Strategy Pattern: Set Analysis Strategy
  setStrategy(strategy: AnalysisStrategy): void {
    this.currentStrategy = strategy
  }

  // Command Pattern: Create Analysis Command
  private createAnalysisCommand(message: string): AnalysisCommand {
    return {
      execute: async () => {
        try {
          // Check cache first
          const cached = await this.cacheService.getCachedSentiment(message)
          if (cached) {
            // Parse cached data
            const parsedContext = JSON.parse(cached.context) as SentimentAnalysisResult['context']
            const parsedScore = parseFloat(cached.sentiment)
            
            return {
              score: {
                score: parsedScore,
                category: this.getCategory(parsedScore),
                confidence: cached.confidence
              },
              context: parsedContext
            }
          }

          // Generate new analysis
          const embedding = await this.generateEmbeddingWithRetry(message)
          const sentimentScore = await this.currentStrategy.analyze(message, embedding)
          const context = await this.generateContext(message, sentimentScore)

          // Prepare cache data
          const cacheData = {
            messageHash: this.hashMessage(message),
            embedding: JSON.stringify(Array.from(embedding)),
            sentiment: sentimentScore.score.toString(),
            confidence: sentimentScore.confidence,
            context: JSON.stringify(context),
            userId: '',  // These will be set by the cache service
            roomId: '',
            senderName: ''
          }

          // Fire and forget cache operation
          setImmediate(() => {
            try {
              this.cacheService.cacheSentiment(cacheData)
                .catch(error => {
                  // Just log cache errors at debug level - never propagate
                  this.logger.debug('Background cache operation failed (expected)', error)
                })
            } catch (error) {
              // Catch any synchronous errors in cache preparation
              this.logger.debug('Error preparing cache data (expected)', error)
            }
          })

          const result = { score: sentimentScore, context }
          this.notifyObservers(result)
          return result
        } catch (error) {
          throw new AnalysisError(
            'Error executing analysis command',
            error instanceof Error ? error : undefined
          )
        }
      }
    }
  }

  private hashMessage(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  // Main public method
  async analyzeSentiment(
    text: string,
    context: SentimentContext
  ): Promise<SentimentAnalysisResult> {
    const startTime = Date.now()
    try {
      if (!this.initialized) {
        await this.initialize()
      }

      // Generate embedding for the input text
      const embeddingStartTime = Date.now()
      const embedding = await this.generateEmbeddingWithRetry(text)
      
      // Record OpenAI API metrics
      this.performanceMonitor.recordAPIMetric({
        service: 'openai',
        operation: 'embedding',
        latency: Date.now() - embeddingStartTime,
        success: true,
        rate_limited: false,
        cost: this.calculateEmbeddingCost(text)
      })
      
      // Calculate sentiment score using strategy
      const sentimentScore = await this.currentStrategy.analyze(text, embedding)
      
      // Get similar messages for context
      const vectorStartTime = Date.now()
      const similar = await this.queryVectorStoreWithRetry({
        vector: Array.from(embedding),
        topK: 5,
        includeMetadata: true
      })

      // Record Pinecone API metrics
      this.performanceMonitor.recordAPIMetric({
        service: 'pinecone',
        operation: 'vector_search',
        latency: Date.now() - vectorStartTime,
        success: true,
        rate_limited: false
      })
      
      // Prepare cache data
      const cacheStartTime = Date.now()
      const cacheData = {
        messageHash: this.hashMessage(text),
        embedding: JSON.stringify(Array.from(embedding)),
        sentiment: sentimentScore.score.toString(),
        confidence: sentimentScore.confidence,
        context: JSON.stringify(similar.matches),
        userId: context.userId,
        roomId: context.roomId,
        senderName: context.senderName || 'Unknown'  // Ensure senderName is always set
      }

      // Fire and forget cache operation
      setImmediate(() => {
        try {
          this.cacheService.cacheSentiment(cacheData)
            .catch(error => {
              // Just log cache errors at debug level - never propagate
              this.logger.debug('Background cache operation failed (expected)', error)
            })
        } catch (error) {
          // Catch any synchronous errors in cache preparation
          this.logger.debug('Error preparing cache data (expected)', error)
        }
      })
      
      // Record cache metrics
      this.performanceMonitor.recordCacheMetric({
        operation: 'hit',
        key: cacheData.messageHash,
        latency: Date.now() - cacheStartTime
      })
      
      const result: SentimentAnalysisResult = {
        score: sentimentScore,
        context: {
          recentTrend: this.calculateTrend(similar.matches.map(m => m.score)),
          volatility: this.calculateVolatility(similar.matches.map(m => m.score)),
          dominantCategory: this.getDominantCategory(similar.matches, sentimentScore.category)
        }
      }

      // Record overall sentiment metrics
      this.performanceMonitor.recordSentimentMetric({
        processing_time: Date.now() - startTime,
        confidence_score: sentimentScore.confidence,
        sentiment_type: this.mapSentimentToType(sentimentScore.category)
      })

      this.notifyObservers(result)
      return result
    } catch (error) {
      // Record API errors if they occurred
      if (error instanceof Error) {
        if (error.message.includes('OpenAI')) {
          this.performanceMonitor.recordAPIMetric({
            service: 'openai',
            operation: 'embedding',
            latency: Date.now() - startTime,
            success: false,
            rate_limited: error.message.includes('rate_limit')
          })
        } else if (error.message.includes('Pinecone')) {
          this.performanceMonitor.recordAPIMetric({
            service: 'pinecone',
            operation: 'vector_search',
            latency: Date.now() - startTime,
            success: false,
            rate_limited: error.message.includes('rate limit')
          })
        }
      }

      throw new AnalysisError(
        'Failed to analyze sentiment',
        error instanceof Error ? error : undefined
      )
    }
  }

  private getCategory(score: number): SentimentScore['category'] {
    const { stronglyBearish, mildlyBearish, neutral, mildlyBullish } = SentimentAnalysisService.THRESHOLDS
    
    if (score <= stronglyBearish) return 'strongly_bearish'
    if (score <= mildlyBearish) return 'mildly_bearish'
    if (score <= neutral) return 'neutral'
    if (score <= mildlyBullish) return 'mildly_bullish'
    return 'strongly_bullish'
  }

  private calculateConfidence(score: number): number {
    return Math.min(Math.abs(score), 1)
  }

  private calculateVolatility(scores: number[]): number {
    if (scores.length < 2) return 0

    const differences = scores.slice(1).map((score, i) => 
      Math.abs(score - scores[i])
    )

    // Amplify large differences more aggressively
    const amplifiedDiffs = differences.map(diff => 
      Math.pow(diff, 3) // Increased power for more amplification
    )

    // Increase recency bias
    const weightedDiffs = amplifiedDiffs.map((diff, i) => 
      diff * Math.pow(4, i / amplifiedDiffs.length) // Increased base for stronger recency bias
    )

    const volatility = weightedDiffs.reduce((sum, diff) => sum + diff, 0) / 
      weightedDiffs.length

    // Much more aggressive final amplification
    return Math.min(1, volatility * 8) // Increased multiplier
  }

  private calculateTrend(scores: number[]): number {
    if (scores.length < 2) return 0

    const changes = scores.slice(1).map((score, i) => 
      score - scores[i]
    )

    // Amplify trend changes more aggressively  
    const amplifiedChanges = changes.map(change => 
      Math.pow(Math.abs(change), 2) * Math.sign(change) // Increased power
    )

    // Increase recency bias
    const weightedChanges = amplifiedChanges.map((change, i) => 
      change * Math.pow(3, i / changes.length) // Increased base
    )

    const trend = weightedChanges.reduce((sum, change) => sum + change, 0) / 
      weightedChanges.length

    // More aggressive final amplification  
    return Math.min(1, Math.max(-1, trend * 6)) // Increased multiplier
  }

  private calculateEmphasisMultiplier(text: string): number {
    let multiplier = 1.0;
    
    // Emoji Intensity - Bullish
    const rocketCount = (text.match(/🚀/gu) || []).length;
    if (rocketCount >= 3) multiplier *= 2.5;
    else if (rocketCount > 0) multiplier *= 1.5;
    
    // Diamond hands / Strong Bullish Emojis
    if (text.match(/💎|🙌/gu)) multiplier *= 2.0;
    if ((text.match(/🔥|💯|⭐/gu) || []).length >= 2) multiplier *= 2.0;
    
    // Bearish Emojis
    if (text.match(/💀|⚰️|🤡|📉/gu)) multiplier *= 1.8;
    
    // CAPS Detection (more nuanced)
    const capsWords = text.split(' ').filter(word => word.length > 2 && word === word.toUpperCase());
    if (capsWords.length >= 2) multiplier *= 2.0;  // Multiple CAPS words
    else if (capsWords.length === 1) multiplier *= 1.5;  // Single CAPS word
    
    // Repeated Characters (like LFGGGG)
    if (/(.)\1{3,}/.test(text)) multiplier *= 1.5;
    
    // Multiple Exclamations
    const exclamationCount = (text.match(/!/g) || []).length;
    if (exclamationCount >= 3) multiplier *= 1.8;
    else if (exclamationCount > 0) multiplier *= 1.3;
    
    // Combined Emphasis
    if (capsWords.length >= 2 && exclamationCount >= 3) multiplier *= 1.5;
    
    return multiplier;
  }

  private async calculateSentimentScore(text: string, embedding: Float32Array): Promise<number> {
    try {
      const lowerText = text.toLowerCase()
      
      // Enhanced word matching with importance weights
      const bullishMatches = SentimentAnalysisService.SENTIMENT_ANCHORS.bullish
        .map(word => ({
          word,
          // Higher weights for stronger terms
          weight: word.length > 6 ? 1.5 : 1.0, // Longer words often carry more meaning
          matches: lowerText.includes(word.toLowerCase())
        }))
        .filter(m => m.matches)

      const bearishMatches = SentimentAnalysisService.SENTIMENT_ANCHORS.bearish
        .map(word => ({
          word,
          weight: word.length > 6 ? 1.5 : 1.0,
          matches: lowerText.includes(word.toLowerCase())
        }))
        .filter(m => m.matches)

      // Calculate weighted base score
      let score = 0
      if (bullishMatches.length > 0 || bearishMatches.length > 0) {
        const bullishScore = bullishMatches.reduce((sum, m) => sum + m.weight, 0)
        const bearishScore = bearishMatches.reduce((sum, m) => sum + m.weight, 0)
        
        // Normalize by total possible weight
        score = (bullishScore - bearishScore) / Math.max(bullishScore + bearishScore, 1)
        
        // Apply sqrt to maintain signal while reducing extreme values
        score = Math.sign(score) * Math.sqrt(Math.abs(score))
      }

      // Context-aware emphasis detection
      const hasExclamation = text.includes('!')
      const isAllCaps = text === text.toUpperCase() && text.length > 3
      const hasPositiveEmojis = /[🚀💎🔥💪]/u.test(text)
      const hasNegativeEmojis = /[💀⚰️🤡📉]/u.test(text)
      
      // Progressive multiplier system
      let multiplier = 1.0
      
      // Base emphasis
      if (hasExclamation) multiplier *= 1.5
      if (isAllCaps) multiplier *= 2.0
      if (hasPositiveEmojis) multiplier *= 1.5
      if (hasNegativeEmojis) multiplier *= 1.5

      // Compound emphasis
      if (text.split('!').length > 2) multiplier *= 1.5
      if (hasExclamation && isAllCaps) multiplier *= 1.5

      // Word-specific emphasis
      const strongPositiveWords = ['amazing', 'incredible', 'excellent']
      const strongNegativeWords = ['terrible', 'awful', 'horrible']
      
      for (const word of strongPositiveWords) {
        if (lowerText.includes(word)) {
          multiplier *= 1.5
          break
        }
      }
      
      for (const word of strongNegativeWords) {
        if (lowerText.includes(word)) {
          multiplier *= 1.5
          break
        }
      }

      // Handle no direct matches but has emphasis
      if (score === 0) {
        if (isAllCaps) score = 0.3
        if (hasExclamation) score += 0.2
        if (hasPositiveEmojis) score += 0.3
        if (hasNegativeEmojis) score = -0.3
      }

      // Apply multiplier with dampening for extreme values
      score = Math.sign(score) * Math.pow(Math.abs(score * multiplier), 0.7)

      // Ensure final score is between -1 and 1
      return Math.min(1, Math.max(-1, score))
    } catch (error) {
      this.logger.error('Error in sentiment analysis:', error)
      return 0 // Default to neutral on error
    }
  }

  private async generateContext(
    message: string,
    currentScore: SentimentScore
  ): Promise<SentimentAnalysisResult['context']> {
    try {
      // Calculate recent trend (average of last 5 messages)
      const index = await this.vectorStore.getIndex()
      const embeddingArray = await this.embeddingService.generateEmbedding(message)
      const embedding = new Float32Array(embeddingArray)
      
      const recentMessages = await index.query({
        vector: Array.from(embedding), // Convert back to number[] for Pinecone
        topK: 5,
        includeMetadata: true
      })

      // Calculate trend from recent messages
      const recentScores = recentMessages.matches.map(m => m.score || 0)
      const recentTrend = this.calculateTrend(recentScores)

      // Calculate volatility
      const volatility = this.calculateVolatility(recentScores)

      // Determine dominant category
      const categories = recentMessages.matches
        .map(m => (m.metadata as { category?: SentimentScore['category'] })?.category)
        .filter((c): c is SentimentScore['category'] => c !== undefined)
      
      const dominantCategory = categories.length > 0
        ? categories.reduce((acc, curr) => {
            acc[curr] = (acc[curr] || 0) + 1
            return acc
          }, {} as Record<SentimentScore['category'], number>)
        : { [currentScore.category]: 1 }

      const maxCategory = Object.entries(dominantCategory)
        .reduce((a, b) => (a[1] > b[1] ? a : b))[0] as SentimentScore['category']

      return {
        recentTrend,
        volatility,
        dominantCategory: maxCategory
      }
    } catch (error) {
      this.logger.error('Error generating context:', error)
      return {
        recentTrend: currentScore.score,
        volatility: Math.abs(currentScore.score) * 0.5,
        dominantCategory: currentScore.category
      }
    }
  }

  private async queryVectorStoreWithRetry(params: any): Promise<VectorQueryResult> {
    try {
      return await this.vectorStore.query(params)
    } catch (error) {
      const vectorError = new VectorStoreError(
        'Failed to query vector store',
        error instanceof Error ? error : undefined
      )
      
      const recovery = await this.errorRecovery.attemptRecovery(
        vectorError,
        () => this.vectorStore.query(params)
      )

      if (!recovery.success) {
        throw vectorError
      }

      return recovery.metadata?.result as VectorQueryResult
    }
  }

  private getDefaultStrategy(): AnalysisStrategy {
    return {
      analyze: async (message: string, embedding: Float32Array): Promise<SentimentScore> => {
        // Pass message first, then embedding to match method signature
        const score = await this.calculateSentimentScore(message, embedding)
        
        // Calculate confidence based on emphasis and match strength
        const confidence = this.calculateEmphasisMultiplier(message) * this.calculateConfidence(score)
        
        return {
          score,
          category: this.getCategory(score),
          confidence
        }
      }
    }
  }

  private getDominantCategory(
    matches: VectorQueryResult['matches'],
    defaultCategory: SentimentScore['category']
  ): SentimentScore['category'] {
    const categories = matches
      .map(m => (m.metadata as { category?: SentimentScore['category'] })?.category)
      .filter((c): c is SentimentScore['category'] => c !== undefined)
    
    if (categories.length === 0) return defaultCategory

    const categoryCount = categories.reduce((acc, curr) => {
      acc[curr] = (acc[curr] || 0) + 1
      return acc
    }, {} as Record<SentimentScore['category'], number>)

    return Object.entries(categoryCount)
      .reduce((a, b) => (a[1] > b[1] ? a : b))[0] as SentimentScore['category']
  }

  async cleanup(): Promise<void> {
    try {
      this.logger.info('Starting sentiment analysis service cleanup')
      
      // Clear in-memory data structures
      this.observers.clear()
      this.referenceEmbeddings.clear()
      this.sentimentAnchors = {
        bullish: [],
        bearish: [],
        neutral: []
      }

      // Clean up cache service
      await this.cacheService.cleanup()
      
      // Reset initialization state
      this.initialized = false

      this.logger.info('Sentiment analysis service cleanup completed')
    } catch (error) {
      this.logger.error(error, 'Error during sentiment analysis service cleanup')
      throw new AnalysisError(
        'Failed to cleanup sentiment analysis service',
        error instanceof Error ? error : undefined
      )
    }
  }

  private calculateEmbeddingCost(text: string): number {
    // OpenAI charges per 1K tokens, current rate is $0.0001 per 1K tokens
    const estimatedTokens = text.length / 4 // rough estimate
    return (estimatedTokens / 1000) * 0.0001
  }

  private mapSentimentToType(category: SentimentScore['category']): 'strongly_negative' | 'mildly_negative' | 'neutral' | 'mildly_positive' | 'strongly_positive' {
    switch (category) {
      case 'strongly_bearish':
        return 'strongly_negative'
      case 'mildly_bearish':
        return 'mildly_negative'
      case 'neutral':
        return 'neutral'
      case 'mildly_bullish':
        return 'mildly_positive'
      case 'strongly_bullish':
        return 'strongly_positive'
    }
  }
} 