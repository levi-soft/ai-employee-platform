
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('sms-service');

// Validation schemas
const PhoneNumberSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format');

const SMSDataSchema = z.object({
  to: z.union([PhoneNumberSchema, z.array(PhoneNumberSchema)]),
  message: z.string().min(1).max(1600), // SMS character limit
  from: z.string().optional(),
  mediaUrls: z.array(z.string().url()).optional()
});

export interface SMSData {
  to: string | string[];
  message: string;
  from?: string;
  mediaUrls?: string[];
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus?: 'queued' | 'sent' | 'delivered' | 'failed';
  cost?: number;
}

export interface SMSTemplate {
  name: string;
  message: string;
  variables: string[];
  category: string;
}

export class SMSService {
  private defaultFrom: string;
  private templates: Map<string, SMSTemplate> = new Map();
  private apiKey: string;
  private apiUrl: string;
  private enabled: boolean;

  constructor() {
    this.defaultFrom = process.env.SMS_FROM_NUMBER || '+1234567890';
    this.apiKey = process.env.SMS_API_KEY || '';
    this.apiUrl = process.env.SMS_API_URL || 'https://api.twilio.com/2010-04-01';
    this.enabled = process.env.SMS_ENABLED === 'true' && !!this.apiKey;

    this.initializeTemplates();

    logger.info('SMS service initialized', {
      enabled: this.enabled,
      from: this.defaultFrom,
      provider: process.env.SMS_PROVIDER || 'twilio'
    });

    if (!this.enabled) {
      logger.warn('SMS service is disabled - missing configuration');
    }
  }

  /**
   * Initialize SMS templates
   */
  private initializeTemplates(): void {
    // Welcome SMS template
    this.templates.set('welcome', {
      name: 'welcome',
      category: 'authentication',
      variables: ['userName', 'loginCode'],
      message: 'Welcome to AI Employee Platform, {{userName}}! Your verification code is: {{loginCode}}. This code expires in 10 minutes.'
    });

    // OTP verification template
    this.templates.set('otp-verification', {
      name: 'otp-verification',
      category: 'security',
      variables: ['code', 'expirationMinutes'],
      message: 'Your verification code is: {{code}}. This code will expire in {{expirationMinutes}} minutes. Do not share this code with anyone.'
    });

    // Password reset template
    this.templates.set('password-reset', {
      name: 'password-reset',
      category: 'security',
      variables: ['resetCode'],
      message: 'Your password reset code is: {{resetCode}}. Use this code to reset your password. If you did not request this, please ignore this message.'
    });

    // AI Agent alert template
    this.templates.set('ai-agent-alert', {
      name: 'ai-agent-alert',
      category: 'notification',
      variables: ['agentName', 'alertType', 'message'],
      message: 'AI Agent Alert: {{agentName}} - {{alertType}}. {{message}}. Check your dashboard for more details.'
    });

    // System maintenance template
    this.templates.set('system-maintenance', {
      name: 'system-maintenance',
      category: 'system',
      variables: ['startTime', 'duration'],
      message: 'Scheduled maintenance: AI Employee Platform will be unavailable starting {{startTime}} for approximately {{duration}}. We apologize for any inconvenience.'
    });

    // Credit limit warning
    this.templates.set('credit-warning', {
      name: 'credit-warning',
      category: 'billing',
      variables: ['remainingCredits', 'threshold'],
      message: 'Credit Alert: Your account has {{remainingCredits}} credits remaining ({{threshold}}% of limit). Please add credits to continue using AI services.'
    });

    logger.info('SMS templates initialized', {
      templateCount: this.templates.size,
      templates: Array.from(this.templates.keys())
    });
  }

  /**
   * Send SMS message
   */
  async sendSMS(smsData: SMSData): Promise<SMSResult> {
    if (!this.enabled) {
      logger.warn('SMS sending attempted but service is disabled');
      return {
        success: false,
        error: 'SMS service is disabled'
      };
    }

    try {
      const validData = SMSDataSchema.parse(smsData);
      
      logger.info('Sending SMS', {
        to: typeof validData.to === 'string' ? [validData.to] : validData.to,
        messageLength: validData.message.length,
        hasMedia: !!validData.mediaUrls?.length
      });

      // Handle multiple recipients
      const recipients = Array.isArray(validData.to) ? validData.to : [validData.to];
      const results: SMSResult[] = [];

      for (const recipient of recipients) {
        const result = await this.sendSingleSMS({
          ...validData,
          to: recipient
        });
        results.push(result);
      }

      // Return combined result for single recipient, or summary for multiple
      if (recipients.length === 1) {
        return results[0];
      } else {
        const successful = results.filter(r => r.success).length;
        return {
          success: successful > 0,
          messageId: `batch-${Date.now()}`,
          deliveryStatus: successful === recipients.length ? 'sent' : 'failed',
          error: successful === 0 ? 'All messages failed' : 
                 successful < recipients.length ? 'Some messages failed' : undefined
        };
      }
    } catch (error) {
      logger.error('Failed to send SMS', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'SMS sending failed'
      };
    }
  }

  /**
   * Send SMS to single recipient
   */
  private async sendSingleSMS(smsData: SMSData & { to: string }): Promise<SMSResult> {
    try {
      // This is a mock implementation - in production, integrate with actual SMS provider (Twilio, AWS SNS, etc.)
      const mockApiResponse = await this.mockSMSApiCall(smsData);

      if (mockApiResponse.success) {
        logger.info('SMS sent successfully', {
          to: smsData.to,
          messageId: mockApiResponse.messageId
        });

        return {
          success: true,
          messageId: mockApiResponse.messageId,
          deliveryStatus: 'queued',
          cost: mockApiResponse.cost
        };
      } else {
        throw new Error(mockApiResponse.error);
      }
    } catch (error) {
      logger.error('Failed to send single SMS', {
        to: smsData.to,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'SMS delivery failed'
      };
    }
  }

  /**
   * Mock SMS API call (replace with actual provider integration)
   */
  private async mockSMSApiCall(smsData: SMSData & { to: string }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    cost?: number;
  }> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    // Simulate various response scenarios
    const scenarios = [
      { success: true, probability: 0.85 }, // 85% success rate
      { success: false, error: 'Invalid phone number', probability: 0.05 },
      { success: false, error: 'Network timeout', probability: 0.05 },
      { success: false, error: 'Insufficient balance', probability: 0.03 },
      { success: false, error: 'Rate limit exceeded', probability: 0.02 }
    ];

    const random = Math.random();
    let cumulativeProbability = 0;
    
    for (const scenario of scenarios) {
      cumulativeProbability += scenario.probability;
      if (random <= cumulativeProbability) {
        if (scenario.success) {
          return {
            success: true,
            messageId: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            cost: this.calculateSMSCost(smsData.message, smsData.mediaUrls?.length || 0)
          };
        } else {
          return {
            success: false,
            error: scenario.error
          };
        }
      }
    }

    // Fallback to success
    return {
      success: true,
      messageId: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      cost: this.calculateSMSCost(smsData.message, smsData.mediaUrls?.length || 0)
    };
  }

  /**
   * Calculate SMS cost based on message length and media
   */
  private calculateSMSCost(message: string, mediaCount: number = 0): number {
    // Base cost for SMS
    const baseCost = 0.01; // $0.01 per SMS segment
    
    // Calculate segments (160 characters per segment for GSM encoding)
    const segments = Math.ceil(message.length / 160);
    
    // Media messages cost more
    const mediaCost = mediaCount * 0.03; // $0.03 per media file
    
    return (segments * baseCost) + mediaCost;
  }

  /**
   * Send SMS using template
   */
  async sendTemplateSMS(
    templateName: string,
    to: string | string[],
    variables: Record<string, string>,
    options: {
      from?: string;
    } = {}
  ): Promise<SMSResult> {
    try {
      const template = this.templates.get(templateName);
      
      if (!template) {
        throw new Error(`SMS template '${templateName}' not found`);
      }

      // Replace variables in message
      let message = template.message;

      Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        message = message.replace(regex, value);
      });

      // Check for unreplaced variables
      const unreplacedVars = template.variables.filter(variable => 
        !variables.hasOwnProperty(variable)
      );

      if (unreplacedVars.length > 0) {
        logger.warn('Template variables not provided', {
          template: templateName,
          missingVariables: unreplacedVars
        });
      }

      return this.sendSMS({
        to,
        message,
        from: options.from || this.defaultFrom
      });
    } catch (error) {
      logger.error('Failed to send template SMS', {
        template: templateName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Template SMS error'
      };
    }
  }

  /**
   * Send bulk SMS messages
   */
  async sendBulkSMS(messages: SMSData[]): Promise<SMSResult[]> {
    if (!this.enabled) {
      return messages.map(() => ({
        success: false,
        error: 'SMS service is disabled'
      }));
    }

    const results: SMSResult[] = [];
    
    logger.info('Sending bulk SMS messages', { count: messages.length });

    // Process messages in batches to respect rate limits
    const batchSize = 5;
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      const batchPromises = batch.map(sms => this.sendSMS(sms));
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason?.message || 'Bulk SMS failed'
          });
        }
      });

      // Delay between batches to respect rate limits
      if (i + batchSize < messages.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    logger.info('Bulk SMS sending completed', {
      total: messages.length,
      successful,
      failed,
      successRate: `${Math.round((successful / messages.length) * 100)}%`
    });

    return results;
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phoneNumber: string): { valid: boolean; formatted?: string; error?: string } {
    try {
      // Basic E.164 format validation
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      
      if (!e164Regex.test(phoneNumber)) {
        return {
          valid: false,
          error: 'Phone number must be in E.164 format (+1234567890)'
        };
      }

      return {
        valid: true,
        formatted: phoneNumber
      };
    } catch (error) {
      return {
        valid: false,
        error: 'Invalid phone number format'
      };
    }
  }

  /**
   * Get delivery status (mock implementation)
   */
  async getDeliveryStatus(messageId: string): Promise<{
    messageId: string;
    status: 'queued' | 'sent' | 'delivered' | 'failed' | 'unknown';
    updatedAt: Date;
    error?: string;
  }> {
    // Mock delivery status check
    const statuses = ['queued', 'sent', 'delivered', 'failed'] as const;
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

    return {
      messageId,
      status: randomStatus,
      updatedAt: new Date(),
      error: randomStatus === 'failed' ? 'Delivery failed' : undefined
    };
  }

  /**
   * Get available templates
   */
  getAvailableTemplates(): SMSTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Add custom template
   */
  addTemplate(template: SMSTemplate): void {
    this.templates.set(template.name, template);
    logger.info('SMS template added', { name: template.name });
  }

  /**
   * Remove template
   */
  removeTemplate(templateName: string): boolean {
    const removed = this.templates.delete(templateName);
    if (removed) {
      logger.info('SMS template removed', { name: templateName });
    }
    return removed;
  }

  /**
   * Test SMS service configuration
   */
  async testService(): Promise<{ success: boolean; message: string }> {
    if (!this.enabled) {
      return {
        success: false,
        message: 'SMS service is disabled or not configured'
      };
    }

    try {
      // Test with a mock message
      const testResult = await this.mockSMSApiCall({
        to: '+1234567890',
        message: 'Test message from AI Employee Platform SMS service'
      });

      return {
        success: testResult.success,
        message: testResult.success ? 'SMS service is working correctly' : 
                testResult.error || 'SMS service test failed'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'SMS service test failed'
      };
    }
  }

  /**
   * Get service statistics
   */
  getServiceStats(): {
    enabled: boolean;
    templateCount: number;
    availableTemplates: string[];
    provider: string;
    defaultFrom: string;
  } {
    return {
      enabled: this.enabled,
      templateCount: this.templates.size,
      availableTemplates: Array.from(this.templates.keys()),
      provider: process.env.SMS_PROVIDER || 'mock',
      defaultFrom: this.defaultFrom
    };
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable/disable service
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && !!this.apiKey;
    logger.info(`SMS service ${enabled ? 'enabled' : 'disabled'}`);
  }
}
