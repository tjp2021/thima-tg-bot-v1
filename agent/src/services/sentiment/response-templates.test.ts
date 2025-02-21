import { ResponseTemplateService, ResponseTemplate } from './response-templates'
import { SentimentScore } from './sentiment.service'

describe('ResponseTemplateService', () => {
  let templateService: ResponseTemplateService

  beforeEach(() => {
    templateService = new ResponseTemplateService()
  })

  describe('getResponse', () => {
    it('should return appropriate response for strongly negative sentiment', () => {
      const score: SentimentScore = {
        score: -0.8,
        category: 'strongly_negative',
        confidence: 0.9
      }

      const response = templateService.getResponse(score)
      expect(response).toBeDefined()
      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
    })

    it('should return appropriate response for strongly positive sentiment', () => {
      const score: SentimentScore = {
        score: 0.8,
        category: 'strongly_positive',
        confidence: 0.9
      }

      const response = templateService.getResponse(score)
      expect(response).toBeDefined()
      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
    })

    it('should return fallback response for low confidence score', () => {
      const score: SentimentScore = {
        score: 0.3,
        category: 'mildly_positive',
        confidence: 0.2
      }

      const response = templateService.getResponse(score)
      expect(response).toBe('I understand. Please tell me more about that.')
    })
  })

  describe('template management', () => {
    it('should allow adding new templates', () => {
      const newTemplate: ResponseTemplate = {
        category: 'neutral',
        template: 'This is a new template',
        useCase: 'test_case',
        confidenceThreshold: 0.5
      }

      templateService.addTemplate(newTemplate)
      
      const score: SentimentScore = {
        score: 0,
        category: 'neutral',
        confidence: 0.6
      }

      // Test multiple times to increase chance of getting new template
      let foundNewTemplate = false
      for (let i = 0; i < 10; i++) {
        const response = templateService.getResponse(score)
        if (response === newTemplate.template) {
          foundNewTemplate = true
          break
        }
      }

      expect(foundNewTemplate).toBe(true)
    })

    it('should allow removing templates', () => {
      const templateToRemove: ResponseTemplate = {
        category: 'neutral',
        template: 'Template to remove',
        useCase: 'remove_test',
        confidenceThreshold: 0.5
      }

      templateService.addTemplate(templateToRemove)
      templateService.removeTemplate('remove_test')

      const score: SentimentScore = {
        score: 0,
        category: 'neutral',
        confidence: 0.6
      }

      // Test multiple times to ensure template is really removed
      let foundRemovedTemplate = false
      for (let i = 0; i < 10; i++) {
        const response = templateService.getResponse(score)
        if (response === templateToRemove.template) {
          foundRemovedTemplate = true
          break
        }
      }

      expect(foundRemovedTemplate).toBe(false)
    })
  })
}) 