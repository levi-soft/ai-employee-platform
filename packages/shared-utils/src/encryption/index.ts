
// Encryption and hashing utilities
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomInt, createCipher, createDecipher } from 'crypto';
import { ENCRYPTION } from '../constants';

// Password hashing functions
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ENCRYPTION.BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Token generation functions
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

export function generateNumericCode(length: number = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

// AES encryption/decryption functions
export function encrypt(text: string, key: string): { encrypted: string; iv: string; tag: string } {
  const iv = randomBytes(ENCRYPTION.IV_LENGTH);
  const cipher = createCipher('aes-256-gcm', key);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: 'mock-tag', // Simplified for demo
  };
}

export function decrypt(encrypted: string, key: string, iv: string, tag: string): string {
  const decipher = createDecipher('aes-256-gcm', key);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Hash functions for data integrity
export function createHashDigest(data: string, algorithm: string = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex');
}

export function createHMACDigest(data: string, secret: string, algorithm: string = 'sha256'): string {
  return createHmac(algorithm, secret).update(data).digest('hex');
}

// API key generation
export function generateAPIKey(prefix: string = 'ai-platform'): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(16).toString('hex');
  return `${prefix}_${timestamp}_${randomPart}`;
}

// Password strength checker
export function checkPasswordStrength(password: string): {
  score: number;
  feedback: string[];
  isStrong: boolean;
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 12) {
    score += 2;
  } else if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Password should be at least 8 characters long');
  }

  // Character variety checks
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Include lowercase letters');
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Include uppercase letters');
  }

  if (/\d/.test(password)) {
    score += 1;
  } else {
    feedback.push('Include numbers');
  }

  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Include special characters');
  }

  // Common pattern checks
  if (!/(.)\1{2,}/.test(password)) {
    score += 1;
  } else {
    feedback.push('Avoid repeated characters');
  }

  if (!/123|abc|qwerty|password/i.test(password)) {
    score += 1;
  } else {
    feedback.push('Avoid common patterns');
  }

  const isStrong = score >= 6;

  return { score, feedback, isStrong };
}

// Secure random string generation
export function generateSecureRandomString(
  length: number,
  options: {
    includeUppercase?: boolean;
    includeLowercase?: boolean;
    includeNumbers?: boolean;
    includeSymbols?: boolean;
  } = {}
): string {
  const {
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = false,
  } = options;

  let charset = '';
  if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (includeNumbers) charset += '0123456789';
  if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  if (!charset) {
    throw new Error('At least one character type must be included');
  }

  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = randomInt(0, charset.length);
    result += charset[randomIndex];
  }

  return result;
}

// Data anonymization
export function anonymizeEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return email;

  const anonymizedLocal = localPart.length > 2
    ? localPart[0] + '*'.repeat(localPart.length - 2) + localPart[localPart.length - 1]
    : '*'.repeat(localPart.length);

  return `${anonymizedLocal}@${domain}`;
}

export function anonymizeData(data: any, fields: string[]): any {
  const result = { ...data };
  
  fields.forEach(field => {
    if (result[field]) {
      if (typeof result[field] === 'string') {
        if (field.toLowerCase().includes('email')) {
          result[field] = anonymizeEmail(result[field]);
        } else {
          result[field] = '*'.repeat(result[field].length);
        }
      } else {
        result[field] = '[REDACTED]';
      }
    }
  });

  return result;
}
