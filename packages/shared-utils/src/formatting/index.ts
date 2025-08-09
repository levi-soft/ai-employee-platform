
// Formatting utilities - using native JavaScript Date API

// Number formatting
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(
  number: number,
  options: {
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
  } = {}
): string {
  const {
    locale = 'en-US',
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    notation = 'standard',
  } = options;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
    notation,
  }).format(number);
}

export function formatPercent(
  value: number,
  locale: string = 'en-US',
  decimals: number = 1
): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

// Date/Time formatting
export function formatDate(
  date: Date | string,
  format: string = 'YYYY-MM-DD',
  timezone?: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  // Simple format implementation for common patterns
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year.toString())
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

export function formatDateTime(
  date: Date | string,
  format: string = 'YYYY-MM-DD HH:mm:ss',
  timezone?: string
): string {
  return formatDate(date, format, timezone);
}

export function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(dateObj, 'YYYY-MM-DD');
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

export function formatResponseTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }
  
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

// String formatting
export function formatName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function formatInitials(firstName: string, lastName: string): string {
  const firstInitial = firstName?.charAt(0)?.toUpperCase() || '';
  const lastInitial = lastName?.charAt(0)?.toUpperCase() || '';
  return `${firstInitial}${lastInitial}`;
}

export function formatEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function formatPhoneNumber(phone: string, format: 'US' | 'INTERNATIONAL' = 'US'): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  if (format === 'US' && digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  if (format === 'US' && digits.length === 11 && digits[0] === '1') {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone; // Return original if can't format
}

// Text formatting
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function camelToKebab(text: string): string {
  return text.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function kebabToCamel(text: string): string {
  return text.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function pluralize(text: string, count: number): string {
  if (count === 1) return text;
  
  // Simple pluralization rules
  if (text.endsWith('y')) {
    return text.slice(0, -1) + 'ies';
  }
  if (text.endsWith('s') || text.endsWith('sh') || text.endsWith('ch')) {
    return text + 'es';
  }
  return text + 's';
}

// URL formatting
export function formatApiUrl(baseUrl: string, path: string, params?: Record<string, any>): string {
  let url = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  
  return url;
}

export function formatSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

// Status formatting
export function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => capitalize(word))
    .join(' ');
}

export function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    active: 'green',
    inactive: 'gray',
    pending: 'yellow',
    suspended: 'red',
    completed: 'green',
    failed: 'red',
    processing: 'blue',
    cancelled: 'gray',
    healthy: 'green',
    degraded: 'yellow',
    unhealthy: 'red',
  };
  
  return statusColors[status.toLowerCase()] || 'gray';
}

// Array formatting
export function formatList(
  items: string[],
  options: {
    conjunction?: 'and' | 'or';
    limit?: number;
    moreText?: string;
  } = {}
): string {
  const { conjunction = 'and', limit, moreText = 'others' } = options;
  
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  
  let displayItems = items;
  let hasMore = false;
  
  if (limit && items.length > limit) {
    displayItems = items.slice(0, limit);
    hasMore = true;
  }
  
  if (displayItems.length === 1) {
    return hasMore ? `${displayItems[0]} and ${items.length - 1} ${moreText}` : displayItems[0];
  }
  
  const lastItem = displayItems.pop();
  const result = `${displayItems.join(', ')} ${conjunction} ${lastItem}`;
  
  if (hasMore && limit !== undefined) {
    return `${result} and ${items.length - limit} ${moreText}`;
  }
  
  return result;
}
