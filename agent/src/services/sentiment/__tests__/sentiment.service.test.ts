import { SentimentAnalysisService, type SentimentAnalysisResult, type SentimentObserver, type AnalysisStrategy } from '../sentiment.service'
import { OpenAIEmbeddingService } from '../../embeddings/openai.service'
import { PineconeService } from '../../vector-store/pinecone.config'
import { Database } from 'better-sqlite3'
import { jest, describe, expect, it, beforeEach } from '@jest/globals'

// Mock dependencies
jest.mock('../../embeddings/openai.service')
jest.mock('../../vector-store/pinecone.config')
jest.mock('better-sqlite3')
jest.mock('pino', () => ({
    default: () => ({
        error: jest.fn(),
        info: jest.fn()
    })
}))

describe('SentimentAnalysisService', () => {
    let service: SentimentAnalysisService
    let mockEmbeddingService: jest.Mocked<OpenAIEmbeddingService>
    let mockVectorStore: jest.Mocked<PineconeService>
    let mockDb: jest.Mocked<Database>
    let mockStrategy: jest.SpyInstance

    beforeEach(() => {
        // Reset mocks
        mockEmbeddingService = {
            generateEmbedding: jest.fn()
        } as any

        mockVectorStore = {
            getIndex: jest.fn()
        } as any

        mockDb = {
            prepare: jest.fn()
        } as any

        mockStrategy = {
            analyze: jest.fn()
        }

        service = new SentimentAnalysisService(
            mockEmbeddingService,
            mockVectorStore,
            mockDb,
            mockStrategy as unknown as AnalysisStrategy
        )
    })

    describe('Sentiment Analysis', () => {
        it('should correctly categorize strongly negative sentiment', async () => {
            const embedding = new Float32Array([0.1, 0.2, 0.3])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))
            jest.spyOn(mockStrategy, 'analyze').mockResolvedValue({
                score: -0.8,
                category: 'strongly_negative',
                confidence: 0.9
            })

            const result = await service.analyzeSentiment('This is terrible!')
            expect(result.score.category).toBe('strongly_negative')
            expect(result.score.confidence).toBeGreaterThan(0)
        })

        it('should correctly categorize strongly positive sentiment', async () => {
            const embedding = new Float32Array([0.7, 0.8, 0.9])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))
            jest.spyOn(mockStrategy, 'analyze').mockResolvedValue({
                score: 0.8,
                category: 'strongly_positive',
                confidence: 0.9
            })

            const result = await service.analyzeSentiment('This is amazing!')
            expect(result.score.category).toBe('strongly_positive')
            expect(result.score.confidence).toBeGreaterThan(0)
        })

        it('should handle neutral sentiment', async () => {
            const embedding = new Float32Array([0.4, 0.5, 0.6])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))
            jest.spyOn(mockStrategy, 'analyze').mockResolvedValue({
                score: 0,
                category: 'neutral',
                confidence: 0.5
            })

            const result = await service.analyzeSentiment('This is okay.')
            expect(result.score.category).toBe('neutral')
            expect(result.score.confidence).toBeLessThan(1)
        })
    })

    describe('Observer Pattern', () => {
        it('should notify observers of sentiment updates', async () => {
            const mockObserver: SentimentObserver = {
                onSentimentUpdate: jest.fn()
            }

            service.addObserver(mockObserver)

            const embedding = new Float32Array([0.1, 0.2, 0.3])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))
            jest.spyOn(mockStrategy, 'analyze').mockResolvedValue({
                score: 0.5,
                category: 'mildly_positive',
                confidence: 0.8
            })

            await service.analyzeSentiment('Test message')

            expect(mockObserver.onSentimentUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    score: expect.objectContaining({
                        category: 'mildly_positive'
                    })
                })
            )
        })

        it('should handle observer removal', async () => {
            const mockObserver: SentimentObserver = {
                onSentimentUpdate: jest.fn()
            }

            service.addObserver(mockObserver)
            service.removeObserver(mockObserver)

            await service.analyzeSentiment('Test message')

            expect(mockObserver.onSentimentUpdate).not.toHaveBeenCalled()
        })
    })

    describe('Strategy Pattern', () => {
        it('should use custom analysis strategy when provided', async () => {
            const customStrategy: AnalysisStrategy = {
                analyze: jest.fn().mockResolvedValue({
                    score: 1,
                    category: 'strongly_positive',
                    confidence: 1
                })
            }

            service.setStrategy(customStrategy)

            const embedding = new Float32Array([0.1, 0.2, 0.3])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))

            const result = await service.analyzeSentiment('Test message')

            expect(customStrategy.analyze).toHaveBeenCalled()
            expect(result.score.category).toBe('strongly_positive')
        })
    })

    describe('Error Handling', () => {
        it('should handle embedding generation errors', async () => {
            mockEmbeddingService.generateEmbedding.mockRejectedValue(new Error('API Error'))

            await expect(service.analyzeSentiment('Test message')).rejects.toThrow('API Error')
        })

        it('should handle analysis errors', async () => {
            const embedding = new Float32Array([0.1, 0.2, 0.3])
            mockEmbeddingService.generateEmbedding.mockResolvedValue(Array.from(embedding))
            jest.spyOn(mockStrategy, 'analyze').mockRejectedValue(new Error('Analysis Error'))

            await expect(service.analyzeSentiment('Test message')).rejects.toThrow('Analysis Error')
        })
    })
}) 