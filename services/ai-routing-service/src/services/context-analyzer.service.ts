
import { logger } from '@ai-platform/shared-utils'

export interface RequestContext {
  intent: RequestIntent
  complexity: ComplexityAnalysis
  capabilities: string[]
  domain: string
  urgency: UrgencyLevel
  patterns: ContextualPatterns
  metadata: ContextMetadata
}

export interface RequestIntent {
  primary: string
  secondary: string[]
  confidence: number
  reasoning: string
}

export interface ComplexityAnalysis {
  overall: number // 0-100 scale
  linguistic: number
  computational: number
  reasoning: number
  factors: string[]
}

export interface ContextualPatterns {
  isFollowUp: boolean
  hasPersonalContext: boolean
  requiresExternalData: boolean
  isCreativeTask: boolean
  isAnalyticalTask: boolean
  hasPreviousContext: boolean
  patterns: Array<{
    type: string
    confidence: number
    details: any
  }>
}

export interface ContextMetadata {
  estimatedTokens: number
  expectedResponseLength: number
  languageDetected: string
  topicTags: string[]
  sentimentScore: number
  formalityLevel: number
  technicalLevel: number
}

export type UrgencyLevel = 'low' | 'normal' | 'high' | 'critical'

export class ContextAnalyzerService {
  private intentPatterns: Map<string, RegExp[]> = new Map()
  private complexityIndicators: Map<string, number> = new Map()
  private domainClassifier: Map<string, string[]> = new Map()
  private analysisHistory: Array<{
    request: any
    context: RequestContext
    timestamp: Date
  }> = []

  constructor() {
    this.initializePatterns()
    logger.info('Context Analyzer Service initialized')
  }

  // Analyze request context comprehensively
  async analyzeRequest(
    prompt: string,
    userId?: string,
    previousContext?: any
  ): Promise<RequestContext> {
    try {
      const startTime = Date.now()
      
      logger.info('Starting context analysis', {
        userId,
        promptLength: prompt.length,
        hasPreviousContext: !!previousContext
      })

      // Parallel analysis for better performance
      const [
        intent,
        complexity,
        capabilities,
        domain,
        urgency,
        patterns,
        metadata
      ] = await Promise.all([
        this.analyzeIntent(prompt),
        this.analyzeComplexity(prompt),
        this.detectRequiredCapabilities(prompt),
        this.classifyDomain(prompt),
        this.assessUrgency(prompt),
        this.detectContextualPatterns(prompt, previousContext),
        this.extractMetadata(prompt)
      ])

      const context: RequestContext = {
        intent,
        complexity,
        capabilities,
        domain,
        urgency,
        patterns,
        metadata
      }

      // Store analysis for learning
      this.analysisHistory.push({
        request: { prompt, userId },
        context,
        timestamp: new Date()
      })

      // Limit history size
      if (this.analysisHistory.length > 1000) {
        this.analysisHistory = this.analysisHistory.slice(-800)
      }

      const analysisTime = Date.now() - startTime
      logger.info('Context analysis completed', {
        userId,
        intent: intent.primary,
        complexity: complexity.overall,
        domain,
        analysisTime: `${analysisTime}ms`
      })

      return context

    } catch (error) {
      logger.error('Error analyzing request context', {
        userId,
        promptLength: prompt.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return this.getDefaultContext(prompt)
    }
  }

  // Analyze request intent
  private async analyzeIntent(prompt: string): Promise<RequestIntent> {
    try {
      const normalizedPrompt = prompt.toLowerCase()
      const intents: Array<{ intent: string; confidence: number; indicators: string[] }> = []

      // Check for primary intent patterns
      for (const [intentType, patterns] of this.intentPatterns.entries()) {
        let matches = 0
        const indicators: string[] = []

        for (const pattern of patterns) {
          if (pattern.test(normalizedPrompt)) {
            matches++
            indicators.push(pattern.source.substring(0, 20) + '...')
          }
        }

        if (matches > 0) {
          const confidence = Math.min(0.95, (matches / patterns.length) * 0.8 + 0.2)
          intents.push({ intent: intentType, confidence, indicators })
        }
      }

      // Sort by confidence
      intents.sort((a, b) => b.confidence - a.confidence)

      // If no specific intent found, classify as general
      if (intents.length === 0) {
        intents.push({
          intent: 'general-query',
          confidence: 0.6,
          indicators: ['general conversation pattern']
        })
      }

      const primary = intents[0]
      const secondary = intents.slice(1, 3).map(i => i.intent)

      return {
        primary: primary.intent,
        secondary,
        confidence: primary.confidence,
        reasoning: `Detected based on: ${primary.indicators.join(', ')}`
      }

    } catch (error) {
      logger.error('Error analyzing intent', { error })
      return {
        primary: 'general-query',
        secondary: [],
        confidence: 0.5,
        reasoning: 'Default classification due to analysis error'
      }
    }
  }

  // Analyze request complexity
  private async analyzeComplexity(prompt: string): Promise<ComplexityAnalysis> {
    try {
      let linguisticComplexity = 0
      let computationalComplexity = 0
      let reasoningComplexity = 0
      const factors: string[] = []

      // Linguistic complexity indicators
      const words = prompt.split(/\s+/)
      const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0)
      const avgWordsPerSentence = words.length / Math.max(1, sentences.length)
      
      if (avgWordsPerSentence > 20) {
        linguisticComplexity += 25
        factors.push('Long sentences')
      }
      
      if (words.length > 500) {
        linguisticComplexity += 30
        factors.push('Long input')
      }

      // Technical/domain-specific terms
      const technicalTerms = this.countTechnicalTerms(prompt)
      linguisticComplexity += Math.min(40, technicalTerms * 5)
      if (technicalTerms > 3) {
        factors.push('Technical terminology')
      }

      // Computational complexity indicators
      const computationalIndicators = [
        /calculat|compute|process|analyze|transform|generate/i,
        /data|dataset|statistics|analysis/i,
        /algorithm|model|optimization/i,
        /comparison|evaluation|ranking/i
      ]

      computationalIndicators.forEach(pattern => {
        if (pattern.test(prompt)) {
          computationalComplexity += 20
        }
      })

      // Reasoning complexity indicators  
      const reasoningIndicators = [
        /why|how|explain|reason|because|therefore/i,
        /compare|contrast|evaluate|judge|decide/i,
        /if.*then|when.*then|given.*find/i,
        /logic|proof|argument|evidence/i
      ]

      reasoningIndicators.forEach(pattern => {
        if (pattern.test(prompt)) {
          reasoningComplexity += 25
        }
      })

      // Multiple questions or tasks
      const questionMarks = (prompt.match(/\?/g) || []).length
      const tasks = (prompt.match(/\b(and|also|then|next|finally)\b/gi) || []).length
      
      if (questionMarks > 1 || tasks > 2) {
        computationalComplexity += 20
        factors.push('Multiple tasks/questions')
      }

      // Normalize scores (0-100)
      linguisticComplexity = Math.min(100, linguisticComplexity)
      computationalComplexity = Math.min(100, computationalComplexity)
      reasoningComplexity = Math.min(100, reasoningComplexity)

      // Overall complexity (weighted average)
      const overall = Math.round(
        (linguisticComplexity * 0.3 + 
         computationalComplexity * 0.4 + 
         reasoningComplexity * 0.3)
      )

      return {
        overall,
        linguistic: linguisticComplexity,
        computational: computationalComplexity,
        reasoning: reasoningComplexity,
        factors
      }

    } catch (error) {
      logger.error('Error analyzing complexity', { error })
      return {
        overall: 50,
        linguistic: 50,
        computational: 50,
        reasoning: 50,
        factors: ['Analysis error - using default values']
      }
    }
  }

  // Detect required capabilities
  private async detectRequiredCapabilities(prompt: string): Promise<string[]> {
    try {
      const capabilities: Set<string> = new Set()
      const normalizedPrompt = prompt.toLowerCase()

      // Text generation capabilities
      if (/writ|generat|creat|compos/i.test(prompt)) {
        capabilities.add('text-generation')
      }

      // Code capabilities
      if (/code|program|script|function|class|debug/i.test(prompt)) {
        capabilities.add('code-generation')
        capabilities.add('debugging')
      }

      // Analysis capabilities
      if (/analyz|evaluat|assess|review|examin/i.test(prompt)) {
        capabilities.add('analysis')
      }

      // Math capabilities
      if (/calculat|math|equation|formula|solve|number/i.test(prompt)) {
        capabilities.add('math')
        capabilities.add('calculation')
      }

      // Reasoning capabilities
      if (/explain|reason|why|how|logic|proof/i.test(prompt)) {
        capabilities.add('reasoning')
        capabilities.add('explanation')
      }

      // Translation capabilities
      if (/translat|convert.*language|from.*to.*language/i.test(prompt)) {
        capabilities.add('translation')
      }

      // Summarization capabilities
      if (/summar|brief|concis|key.*point|main.*idea/i.test(prompt)) {
        capabilities.add('summarization')
      }

      // Creative capabilities
      if (/creativ|story|poem|brainstorm|imaginat|fiction/i.test(prompt)) {
        capabilities.add('creative')
      }

      // Research capabilities
      if (/research|find.*information|search|lookup/i.test(prompt)) {
        capabilities.add('research')
      }

      // Question answering
      if (/\?|what|when|where|who|which|how/i.test(prompt)) {
        capabilities.add('question-answering')
      }

      // If no specific capabilities detected, add general
      if (capabilities.size === 0) {
        capabilities.add('general-query')
      }

      return Array.from(capabilities)

    } catch (error) {
      logger.error('Error detecting capabilities', { error })
      return ['general-query']
    }
  }

  // Classify domain
  private async classifyDomain(prompt: string): Promise<string> {
    try {
      const normalizedPrompt = prompt.toLowerCase()

      for (const [domain, keywords] of this.domainClassifier.entries()) {
        const matches = keywords.filter(keyword => 
          normalizedPrompt.includes(keyword.toLowerCase())
        ).length

        if (matches >= 2) {
          return domain
        }
      }

      // Fallback domain classification
      if (/code|programming|software|development/i.test(prompt)) {
        return 'technology'
      } else if (/business|market|sales|finance/i.test(prompt)) {
        return 'business'
      } else if (/science|research|study|academic/i.test(prompt)) {
        return 'academic'
      } else if (/creative|art|design|story/i.test(prompt)) {
        return 'creative'
      } else {
        return 'general'
      }

    } catch (error) {
      logger.error('Error classifying domain', { error })
      return 'general'
    }
  }

  // Assess urgency level
  private async assessUrgency(prompt: string): Promise<UrgencyLevel> {
    try {
      const normalizedPrompt = prompt.toLowerCase()

      // Critical urgency indicators
      if (/urgent|emergency|asap|immediately|critical|deadline/i.test(prompt)) {
        return 'critical'
      }

      // High urgency indicators
      if (/quickly|fast|soon|priority|important|need.*now/i.test(prompt)) {
        return 'high'
      }

      // Low urgency indicators
      if (/when.*convenient|no rush|eventually|sometime/i.test(prompt)) {
        return 'low'
      }

      // Normal urgency (default)
      return 'normal'

    } catch (error) {
      logger.error('Error assessing urgency', { error })
      return 'normal'
    }
  }

  // Detect contextual patterns
  private async detectContextualPatterns(
    prompt: string,
    previousContext?: any
  ): Promise<ContextualPatterns> {
    try {
      const patterns: Array<{ type: string; confidence: number; details: any }> = []

      // Follow-up detection
      const isFollowUp = /continue|also|addition|furthermore|moreover|follow.*up/i.test(prompt) ||
                        /previous|earlier|before|above|that/i.test(prompt)

      // Personal context detection
      const hasPersonalContext = /my|mine|i|me|personal|own/i.test(prompt)

      // External data requirement
      const requiresExternalData = /current|latest|recent|today|news|real.*time/i.test(prompt) ||
                                  /search|find|lookup|check/i.test(prompt)

      // Creative task detection
      const isCreativeTask = /creat|writ.*story|poem|fiction|imaginat|brainstorm/i.test(prompt)

      // Analytical task detection
      const isAnalyticalTask = /analyz|evaluat|compar|assess|statistics|data/i.test(prompt)

      // Previous context usage
      const hasPreviousContext = !!previousContext && Object.keys(previousContext).length > 0

      // Detect specific patterns
      if (isFollowUp) {
        patterns.push({
          type: 'follow-up',
          confidence: 0.8,
          details: { indicatorFound: true }
        })
      }

      if (hasPersonalContext) {
        patterns.push({
          type: 'personal-context',
          confidence: 0.7,
          details: { personalPronouns: true }
        })
      }

      if (requiresExternalData) {
        patterns.push({
          type: 'external-data',
          confidence: 0.9,
          details: { realTimeRequired: true }
        })
      }

      return {
        isFollowUp,
        hasPersonalContext,
        requiresExternalData,
        isCreativeTask,
        isAnalyticalTask,
        hasPreviousContext,
        patterns
      }

    } catch (error) {
      logger.error('Error detecting contextual patterns', { error })
      return {
        isFollowUp: false,
        hasPersonalContext: false,
        requiresExternalData: false,
        isCreativeTask: false,
        isAnalyticalTask: false,
        hasPreviousContext: false,
        patterns: []
      }
    }
  }

  // Extract metadata
  private async extractMetadata(prompt: string): Promise<ContextMetadata> {
    try {
      const words = prompt.split(/\s+/)
      const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0)

      // Estimate tokens (rough approximation)
      const estimatedTokens = Math.ceil(words.length * 1.3)

      // Expected response length based on request
      let expectedResponseLength = estimatedTokens * 2 // Default: response twice as long
      
      if (/brief|short|concise|summary/i.test(prompt)) {
        expectedResponseLength = Math.min(expectedResponseLength, 200)
      } else if (/detailed|comprehensive|thorough|complete/i.test(prompt)) {
        expectedResponseLength *= 2
      }

      // Language detection (simple)
      const languageDetected = this.detectLanguage(prompt)

      // Topic tags
      const topicTags = this.extractTopicTags(prompt)

      // Sentiment analysis (simple)
      const sentimentScore = this.analyzeSentiment(prompt)

      // Formality level
      const formalityLevel = this.assessFormality(prompt)

      // Technical level
      const technicalLevel = this.assessTechnicalLevel(prompt)

      return {
        estimatedTokens,
        expectedResponseLength,
        languageDetected,
        topicTags,
        sentimentScore,
        formalityLevel,
        technicalLevel
      }

    } catch (error) {
      logger.error('Error extracting metadata', { error })
      return {
        estimatedTokens: 100,
        expectedResponseLength: 200,
        languageDetected: 'en',
        topicTags: [],
        sentimentScore: 0,
        formalityLevel: 0.5,
        technicalLevel: 0.5
      }
    }
  }

  // Initialize pattern matching
  private initializePatterns(): void {
    try {
      // Intent patterns
      this.intentPatterns.set('question-answering', [
        /what\s+is|what\s+are|what\s+does/i,
        /who\s+is|who\s+are|who\s+was/i,
        /when\s+is|when\s+was|when\s+will/i,
        /where\s+is|where\s+are|where\s+can/i,
        /why\s+is|why\s+does|why\s+did/i,
        /how\s+to|how\s+do|how\s+can/i
      ])

      this.intentPatterns.set('content-generation', [
        /write\s+a|create\s+a|generate\s+a/i,
        /help\s+me\s+write|help\s+me\s+create/i,
        /draft\s+a|compose\s+a/i,
        /make\s+a\s+list|create\s+a\s+list/i
      ])

      this.intentPatterns.set('code-assistance', [
        /write\s+code|create\s+code|generate\s+code/i,
        /debug\s+this|fix\s+this\s+code|help\s+with\s+code/i,
        /function\s+to|class\s+to|script\s+to/i,
        /programming\s+help|coding\s+help/i
      ])

      this.intentPatterns.set('analysis-request', [
        /analyz|evaluate|assess|review/i,
        /compare\s+and\s+contrast|compare\s+between/i,
        /pros\s+and\s+cons|advantages\s+and\s+disadvantages/i,
        /explain\s+the\s+difference|what.*difference/i
      ])

      // Domain classifier
      this.domainClassifier.set('technology', [
        'software', 'programming', 'code', 'algorithm', 'database', 'API', 'framework',
        'computer', 'digital', 'internet', 'web', 'mobile', 'app', 'system'
      ])

      this.domainClassifier.set('business', [
        'marketing', 'sales', 'revenue', 'profit', 'customer', 'client', 'business',
        'strategy', 'management', 'finance', 'budget', 'investment', 'market'
      ])

      this.domainClassifier.set('academic', [
        'research', 'study', 'analysis', 'theory', 'methodology', 'academic',
        'scientific', 'literature', 'paper', 'thesis', 'education', 'learning'
      ])

      this.domainClassifier.set('creative', [
        'creative', 'art', 'design', 'story', 'fiction', 'poetry', 'music',
        'artistic', 'imagination', 'brainstorm', 'innovative', 'original'
      ])

      logger.info('Context analyzer patterns initialized', {
        intentPatterns: this.intentPatterns.size,
        domainClassifiers: this.domainClassifier.size
      })

    } catch (error) {
      logger.error('Error initializing patterns', { error })
    }
  }

  // Count technical terms in prompt
  private countTechnicalTerms(prompt: string): number {
    const technicalTerms = [
      'algorithm', 'database', 'API', 'framework', 'architecture', 'optimization',
      'integration', 'authentication', 'encryption', 'protocol', 'interface',
      'methodology', 'implementation', 'configuration', 'infrastructure'
    ]

    const normalizedPrompt = prompt.toLowerCase()
    return technicalTerms.filter(term => 
      normalizedPrompt.includes(term)
    ).length
  }

  // Simple language detection
  private detectLanguage(prompt: string): string {
    // Simple language detection based on common words
    const languageIndicators = {
      en: ['the', 'and', 'is', 'in', 'to', 'of', 'a', 'that', 'it', 'with'],
      es: ['el', 'la', 'de', 'que', 'y', 'es', 'en', 'un', 'se', 'no'],
      fr: ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir'],
      de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich']
    }

    const words = prompt.toLowerCase().split(/\s+/)
    const scores: Record<string, number> = {}

    for (const [lang, indicators] of Object.entries(languageIndicators)) {
      scores[lang] = indicators.filter(indicator => words.includes(indicator)).length
    }

    const detectedLang = Object.entries(scores).reduce((a, b) => 
      scores[a[0]] > scores[b[0]] ? a : b
    )[0]

    return scores[detectedLang] > 0 ? detectedLang : 'en'
  }

  // Extract topic tags
  private extractTopicTags(prompt: string): string[] {
    const topicKeywords = {
      'technology': /technology|software|computer|digital|programming|code/i,
      'business': /business|marketing|sales|finance|strategy|management/i,
      'science': /science|research|study|experiment|analysis|data/i,
      'education': /education|learning|teach|student|academic|school/i,
      'health': /health|medical|doctor|treatment|disease|wellness/i,
      'entertainment': /entertainment|movie|music|game|fun|leisure/i
    }

    const tags: string[] = []
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(prompt)) {
        tags.push(topic)
      }
    }

    return tags
  }

  // Simple sentiment analysis
  private analyzeSentiment(prompt: string): number {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'happy', 'please']
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'sad', 'angry', 'problem', 'issue']

    const words = prompt.toLowerCase().split(/\s+/)
    const positiveCount = positiveWords.filter(word => words.includes(word)).length
    const negativeCount = negativeWords.filter(word => words.includes(word)).length

    // Return sentiment score between -1 (negative) and 1 (positive)
    const totalSentimentWords = positiveCount + negativeCount
    if (totalSentimentWords === 0) return 0

    return (positiveCount - negativeCount) / totalSentimentWords
  }

  // Assess formality level
  private assessFormality(prompt: string): number {
    const formalIndicators = ['please', 'would', 'could', 'may', 'shall', 'furthermore', 'therefore', 'consequently']
    const informalIndicators = ["don't", "can't", "won't", "it's", "that's", 'gonna', 'wanna', 'yeah', 'ok', 'cool']

    const normalizedPrompt = prompt.toLowerCase()
    const formalCount = formalIndicators.filter(indicator => normalizedPrompt.includes(indicator)).length
    const informalCount = informalIndicators.filter(indicator => normalizedPrompt.includes(indicator)).length

    const totalIndicators = formalCount + informalCount
    if (totalIndicators === 0) return 0.5 // Neutral

    return formalCount / totalIndicators // 0 = informal, 1 = formal
  }

  // Assess technical level
  private assessTechnicalLevel(prompt: string): number {
    const technicalLevel = this.countTechnicalTerms(prompt)
    const words = prompt.split(/\s+/).length
    
    // Normalize based on prompt length
    return Math.min(1, (technicalLevel / words) * 10)
  }

  // Get default context for error cases
  private getDefaultContext(prompt: string): RequestContext {
    return {
      intent: {
        primary: 'general-query',
        secondary: [],
        confidence: 0.5,
        reasoning: 'Default classification'
      },
      complexity: {
        overall: 50,
        linguistic: 50,
        computational: 50,
        reasoning: 50,
        factors: ['Default analysis']
      },
      capabilities: ['general-query'],
      domain: 'general',
      urgency: 'normal',
      patterns: {
        isFollowUp: false,
        hasPersonalContext: false,
        requiresExternalData: false,
        isCreativeTask: false,
        isAnalyticalTask: false,
        hasPreviousContext: false,
        patterns: []
      },
      metadata: {
        estimatedTokens: Math.ceil(prompt.split(/\s+/).length * 1.3),
        expectedResponseLength: 200,
        languageDetected: 'en',
        topicTags: [],
        sentimentScore: 0,
        formalityLevel: 0.5,
        technicalLevel: 0.3
      }
    }
  }

  // Get context analysis metrics
  async getAnalysisMetrics(): Promise<{
    totalAnalyses: number
    averageComplexity: number
    mostCommonIntents: Array<{ intent: string; count: number }>
    domainDistribution: Record<string, number>
    accuracyScore: number
  }> {
    try {
      const recentAnalyses = this.analysisHistory.slice(-500) // Last 500 analyses

      if (recentAnalyses.length === 0) {
        return {
          totalAnalyses: 0,
          averageComplexity: 0,
          mostCommonIntents: [],
          domainDistribution: {},
          accuracyScore: 0.7
        }
      }

      // Calculate average complexity
      const avgComplexity = recentAnalyses.reduce((sum, analysis) => 
        sum + analysis.context.complexity.overall, 0
      ) / recentAnalyses.length

      // Count intents
      const intentCounts: Record<string, number> = {}
      const domainCounts: Record<string, number> = {}

      recentAnalyses.forEach(analysis => {
        const intent = analysis.context.intent.primary
        const domain = analysis.context.domain

        intentCounts[intent] = (intentCounts[intent] || 0) + 1
        domainCounts[domain] = (domainCounts[domain] || 0) + 1
      })

      const mostCommonIntents = Object.entries(intentCounts)
        .map(([intent, count]) => ({ intent, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      // Simple accuracy estimation (would be calculated differently in production)
      const accuracyScore = 0.8 + (Math.random() * 0.1) // Simulated accuracy between 80-90%

      return {
        totalAnalyses: this.analysisHistory.length,
        averageComplexity: Math.round(avgComplexity),
        mostCommonIntents,
        domainDistribution: domainCounts,
        accuracyScore
      }

    } catch (error) {
      logger.error('Error getting analysis metrics', { error })
      throw new Error('Failed to get analysis metrics')
    }
  }
}
