
import nodemailer, { Transporter } from 'nodemailer';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('email-service');

// Validation schemas
const EmailRecipientSchema = z.object({
  email: z.string().email(),
  name: z.string().optional()
});

const EmailDataSchema = z.object({
  to: z.union([EmailRecipientSchema, z.array(EmailRecipientSchema)]),
  subject: z.string().min(1).max(200),
  text: z.string().optional(),
  html: z.string().optional(),
  from: z.object({
    email: z.string().email(),
    name: z.string().optional()
  }).optional(),
  replyTo: z.string().email().optional(),
  cc: z.array(EmailRecipientSchema).optional(),
  bcc: z.array(EmailRecipientSchema).optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.union([z.string(), z.any()]),
    encoding: z.string().optional(),
    contentType: z.string().optional()
  })).optional()
});

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailData {
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
  from?: EmailRecipient;
  replyTo?: string;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    encoding?: string;
    contentType?: string;
  }>;
}

export interface EmailTemplate {
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  rejectedRecipients?: string[];
}

export class EmailService {
  private transporter: Transporter;
  private defaultFrom: EmailRecipient;
  private templates: Map<string, EmailTemplate> = new Map();

  constructor() {
    this.defaultFrom = {
      email: process.env.SMTP_FROM_EMAIL || 'noreply@ai-platform.com',
      name: process.env.SMTP_FROM_NAME || 'AI Employee Platform'
    };

    // Initialize SMTP transporter
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 14 // 14 emails per second max
    });

    this.initializeTemplates();
    this.verifyConnection();

    logger.info('Email service initialized', {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      from: this.defaultFrom
    });
  }

  /**
   * Initialize email templates
   */
  private initializeTemplates(): void {
    // Welcome email template
    this.templates.set('welcome', {
      name: 'welcome',
      subject: 'Welcome to AI Employee Platform',
      variables: ['userName', 'loginUrl'],
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to AI Employee Platform</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to AI Employee Platform</h1>
          </div>
          
          <div style="padding: 40px 20px; background: #f8f9fa; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Hello {{userName}}!</h2>
            
            <p>We're excited to have you join the AI Employee Platform. Your account has been successfully created and you're ready to start exploring our AI-powered tools and services.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{loginUrl}}" style="display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Access Your Dashboard</a>
            </div>
            
            <h3>What's Next?</h3>
            <ul style="padding-left: 20px;">
              <li>Complete your profile setup</li>
              <li>Explore available AI agents</li>
              <li>Configure your notification preferences</li>
              <li>Start collaborating with your team</li>
            </ul>
            
            <p>If you have any questions or need assistance, our support team is here to help. Simply reply to this email or visit our help center.</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #666; font-size: 14px; text-align: center;">
              This email was sent to you because an account was created for you on AI Employee Platform.<br>
              If you didn't create this account, please contact our support team immediately.
            </p>
          </div>
        </body>
        </html>
      `
    });

    // Password reset template
    this.templates.set('password-reset', {
      name: 'password-reset',
      subject: 'Reset Your Password - AI Employee Platform',
      variables: ['userName', 'resetUrl', 'expirationTime'],
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f44336; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Password Reset Request</h1>
          </div>
          
          <div style="padding: 30px 20px; background: #f8f9fa; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Hi {{userName}},</h2>
            
            <p>We received a request to reset your password for your AI Employee Platform account. If you made this request, click the button below to reset your password:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{resetUrl}}" style="display: inline-block; padding: 15px 30px; background: #f44336; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
            </div>
            
            <p><strong>Important:</strong> This link will expire in {{expirationTime}} for security reasons.</p>
            
            <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
            
            <div style="background: #fff3cd; border: 1px solid #ffeeba; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0; color: #856404;"><strong>Security Tip:</strong> Never share your login credentials with anyone. AI Employee Platform will never ask for your password via email.</p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #666; font-size: 14px;">
              If you're having trouble clicking the reset button, copy and paste the URL below into your web browser:<br>
              <span style="word-break: break-all;">{{resetUrl}}</span>
            </p>
          </div>
        </body>
        </html>
      `
    });

    // AI Agent notification template
    this.templates.set('ai-agent-notification', {
      name: 'ai-agent-notification',
      subject: 'AI Agent Update - {{agentName}}',
      variables: ['userName', 'agentName', 'notificationType', 'message', 'dashboardUrl'],
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>AI Agent Notification</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #2196F3; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">AI Agent Notification</h1>
          </div>
          
          <div style="padding: 30px 20px; background: #f8f9fa; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Hi {{userName}},</h2>
            
            <p>Your AI Agent <strong>{{agentName}}</strong> has an important update:</p>
            
            <div style="background: white; border-left: 4px solid #2196F3; padding: 20px; margin: 20px 0; border-radius: 0 5px 5px 0;">
              <h3 style="color: #2196F3; margin-top: 0;">{{notificationType}}</h3>
              <p style="margin-bottom: 0;">{{message}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{dashboardUrl}}" style="display: inline-block; padding: 15px 30px; background: #2196F3; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">View in Dashboard</a>
            </div>
            
            <p>This notification was sent based on your current preferences. You can update your notification settings in your dashboard.</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #666; font-size: 14px; text-align: center;">
              AI Employee Platform - Empowering your workforce with AI
            </p>
          </div>
        </body>
        </html>
      `
    });

    logger.info('Email templates initialized', {
      templateCount: this.templates.size,
      templates: Array.from(this.templates.keys())
    });
  }

  /**
   * Verify SMTP connection
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      logger.info('SMTP connection verified successfully');
    } catch (error) {
      logger.error('SMTP connection verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send email
   */
  async sendEmail(emailData: EmailData): Promise<EmailResult> {
    try {
      const validData = EmailDataSchema.parse(emailData);
      
      logger.info('Sending email', {
        to: Array.isArray(validData.to) ? validData.to.map(r => r.email) : validData.to.email,
        subject: validData.subject,
        hasHtml: !!validData.html,
        hasText: !!validData.text
      });

      // Prepare recipients
      const toAddresses = Array.isArray(validData.to) ? validData.to : [validData.to];
      
      const mailOptions = {
        from: validData.from ? `${validData.from.name || ''} <${validData.from.email}>` : 
              `${this.defaultFrom.name} <${this.defaultFrom.email}>`,
        to: toAddresses.map(recipient => 
          recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email
        ).join(', '),
        subject: validData.subject,
        text: validData.text,
        html: validData.html,
        replyTo: validData.replyTo,
        cc: validData.cc?.map(recipient => 
          recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email
        ).join(', '),
        bcc: validData.bcc?.map(recipient => 
          recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email
        ).join(', '),
        attachments: validData.attachments
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info('Email sent successfully', {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected
      });

      return {
        success: true,
        messageId: result.messageId,
        rejectedRecipients: result.rejected
      };
    } catch (error) {
      logger.error('Failed to send email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subject: emailData.subject
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown email error'
      };
    }
  }

  /**
   * Send email using template
   */
  async sendTemplateEmail(
    templateName: string,
    to: EmailRecipient | EmailRecipient[],
    variables: Record<string, string>,
    options: {
      from?: EmailRecipient;
      replyTo?: string;
      cc?: EmailRecipient[];
      bcc?: EmailRecipient[];
    } = {}
  ): Promise<EmailResult> {
    try {
      const template = this.templates.get(templateName);
      
      if (!template) {
        throw new Error(`Email template '${templateName}' not found`);
      }

      // Replace variables in subject and HTML
      let subject = template.subject;
      let html = template.html;

      Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        subject = subject.replace(regex, value);
        html = html.replace(regex, value);
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

      return this.sendEmail({
        to,
        subject,
        html,
        ...options
      });
    } catch (error) {
      logger.error('Failed to send template email', {
        template: templateName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Template email error'
      };
    }
  }

  /**
   * Send bulk emails
   */
  async sendBulkEmails(emails: EmailData[]): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    
    logger.info('Sending bulk emails', { count: emails.length });

    // Process emails in batches to avoid overwhelming the SMTP server
    const batchSize = 10;
    
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(email => this.sendEmail(email));
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason?.message || 'Bulk email failed'
          });
        }
      });

      // Small delay between batches
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    logger.info('Bulk email sending completed', {
      total: emails.length,
      successful,
      failed,
      successRate: `${Math.round((successful / emails.length) * 100)}%`
    });

    return results;
  }

  /**
   * Get available templates
   */
  getAvailableTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Add custom template
   */
  addTemplate(template: EmailTemplate): void {
    this.templates.set(template.name, template);
    logger.info('Email template added', { name: template.name });
  }

  /**
   * Remove template
   */
  removeTemplate(templateName: string): boolean {
    const removed = this.templates.delete(templateName);
    if (removed) {
      logger.info('Email template removed', { name: templateName });
    }
    return removed;
  }

  /**
   * Test email configuration
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.transporter.verify();
      return {
        success: true,
        message: 'Email service is working correctly'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Email service test failed'
      };
    }
  }

  /**
   * Get service statistics
   */
  getServiceStats(): {
    isConnected: boolean;
    templateCount: number;
    availableTemplates: string[];
  } {
    return {
      isConnected: this.transporter.transporter.isIdle(),
      templateCount: this.templates.size,
      availableTemplates: Array.from(this.templates.keys())
    };
  }
}
