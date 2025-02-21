import { SentimentScore } from './sentiment.service'

export interface ResponseTemplate {
  template: string
  useCase: string
  category: SentimentScore['category']
  confidenceThreshold?: number
}

export class ResponseTemplateService {
  private templates: ResponseTemplate[] = [
    // Strongly Negative Templates
    {
      category: 'strongly_negative',
      template: "I understand you're feeling very frustrated. Let's try to work through this together. What specific aspects are bothering you the most?",
      useCase: 'general_negative',
      confidenceThreshold: 0.7
    },
    {
      category: 'strongly_negative',
      template: "I hear your concerns and they're valid. Would you like to discuss potential solutions?",
      useCase: 'problem_solving',
      confidenceThreshold: 0.6
    },

    // Mildly Negative Templates
    {
      category: 'mildly_negative',
      template: "I sense some concern in your message. Could you tell me more about what's on your mind?",
      useCase: 'general_concern',
      confidenceThreshold: 0.6
    },
    {
      category: 'mildly_negative',
      template: "Things might not be ideal right now, but let's look at this from a different perspective.",
      useCase: 'perspective_shift',
      confidenceThreshold: 0.5
    },

    // Neutral Templates
    {
      category: 'neutral',
      template: "I understand. Would you like to explore this topic further?",
      useCase: 'general_neutral',
      confidenceThreshold: 0.5
    },
    {
      category: 'neutral',
      template: "That's interesting. Could you elaborate on that?",
      useCase: 'exploration',
      confidenceThreshold: 0.4
    },

    // Mildly Positive Templates
    {
      category: 'mildly_positive',
      template: "I'm glad things are going well! What aspects are you finding most encouraging?",
      useCase: 'general_positive',
      confidenceThreshold: 0.6
    },
    {
      category: 'mildly_positive',
      template: "That's good to hear! Would you like to discuss how to build on this positive momentum?",
      useCase: 'momentum_building',
      confidenceThreshold: 0.5
    },

    // Strongly Positive Templates
    {
      category: 'strongly_positive',
      template: "That's fantastic! Your enthusiasm is contagious. What's the best part about this for you?",
      useCase: 'general_excitement',
      confidenceThreshold: 0.7
    },
    {
      category: 'strongly_positive',
      template: "I'm thrilled to hear about your success! Would you like to share more details about how you achieved this?",
      useCase: 'success_story',
      confidenceThreshold: 0.6
    }
  ]

  getResponse(score: SentimentScore): string {
    // Filter templates by category and confidence threshold
    const eligibleTemplates = this.templates.filter(template => 
      template.category === score.category &&
      (!template.confidenceThreshold || score.confidence >= template.confidenceThreshold)
    )

    if (eligibleTemplates.length === 0) {
      // Fallback to a generic response if no eligible templates
      return "I understand. Please tell me more about that."
    }

    // Randomly select from eligible templates to add variety
    const randomIndex = Math.floor(Math.random() * eligibleTemplates.length)
    return eligibleTemplates[randomIndex].template
  }

  addTemplate(template: ResponseTemplate): void {
    this.templates.push(template)
  }

  removeTemplate(useCase: string): void {
    this.templates = this.templates.filter(t => t.useCase !== useCase)
  }
} 