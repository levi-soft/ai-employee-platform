
module.exports = {
  // Consul configuration
  consul: {
    host: process.env.CONSUL_HOST || 'localhost',
    port: parseInt(process.env.CONSUL_PORT) || 8500,
    secure: process.env.CONSUL_SECURE === 'true',
    token: process.env.CONSUL_TOKEN,
    ca: process.env.CONSUL_CA,
    cert: process.env.CONSUL_CERT,
    key: process.env.CONSUL_KEY,
  },

  // Service registration defaults
  service: {
    name: process.env.SERVICE_NAME || 'ai-platform-service',
    id: process.env.SERVICE_ID || `${process.env.SERVICE_NAME || 'service'}-${process.env.HOSTNAME || 'localhost'}-${process.env.PORT || '3000'}`,
    address: process.env.SERVICE_ADDRESS || 'localhost',
    port: parseInt(process.env.SERVICE_PORT || process.env.PORT) || 3000,
    tags: (process.env.SERVICE_TAGS || '').split(',').filter(Boolean),
    meta: {
      version: process.env.SERVICE_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      region: process.env.AWS_REGION || 'us-east-1',
      zone: process.env.AVAILABILITY_ZONE || 'us-east-1a',
    },
    connect: {
      sidecar_service: process.env.ENABLE_SIDECAR === 'true',
    },
  },

  // Health check configuration
  healthCheck: {
    http: process.env.HEALTH_CHECK_URL || `http://${process.env.SERVICE_ADDRESS || 'localhost'}:${process.env.SERVICE_PORT || process.env.PORT || 3000}/health`,
    interval: process.env.HEALTH_CHECK_INTERVAL || '10s',
    timeout: process.env.HEALTH_CHECK_TIMEOUT || '3s',
    deregisterCriticalServiceAfter: process.env.HEALTH_CHECK_DEREGISTER_AFTER || '30s',
    tlsSkipVerify: process.env.HEALTH_CHECK_TLS_SKIP_VERIFY === 'true',
  },

  // Service discovery configuration
  discovery: {
    // Services to discover
    services: {
      'auth-service': {
        healthCheck: true,
        tags: ['auth', 'api'],
        passing: true,
      },
      'user-management-service': {
        healthCheck: true,
        tags: ['users', 'api'],
        passing: true,
      },
      'ai-routing-service': {
        healthCheck: true,
        tags: ['ai', 'routing', 'api'],
        passing: true,
      },
      'billing-service': {
        healthCheck: true,
        tags: ['billing', 'payments', 'api'],
        passing: true,
      },
      'plugin-manager-service': {
        healthCheck: true,
        tags: ['plugins', 'management', 'api'],
        passing: true,
      },
      'notification-service': {
        healthCheck: true,
        tags: ['notifications', 'messaging', 'api'],
        passing: true,
      },
    },

    // Watch configuration
    watch: {
      enabled: process.env.CONSUL_WATCH_ENABLED !== 'false',
      method: 'longpoll', // or 'blocking'
      index: null,
      wait: '30s',
    },

    // Load balancing strategy
    loadBalancing: {
      strategy: process.env.LB_STRATEGY || 'round-robin', // round-robin, least-connections, random
      healthyOnly: true,
      maxRetries: 3,
      retryDelay: 1000,
    },
  },

  // KV store configuration
  kv: {
    prefix: process.env.CONSUL_KV_PREFIX || 'ai-platform/',
    separator: '/',
    encoding: 'utf8',
  },

  // Session configuration
  session: {
    ttl: parseInt(process.env.CONSUL_SESSION_TTL) || 60,
    lockDelay: parseInt(process.env.CONSUL_LOCK_DELAY) || 15,
    behavior: 'release',
  },

  // Event configuration
  events: {
    enabled: process.env.CONSUL_EVENTS_ENABLED === 'true',
    nodeFilter: process.env.CONSUL_EVENT_NODE_FILTER || '',
    serviceFilter: process.env.CONSUL_EVENT_SERVICE_FILTER || 'ai-platform',
    tagFilter: process.env.CONSUL_EVENT_TAG_FILTER || 'api',
  },

  // ACL configuration
  acl: {
    enabled: process.env.CONSUL_ACL_ENABLED === 'true',
    token: process.env.CONSUL_ACL_TOKEN,
    policy: process.env.CONSUL_ACL_POLICY || 'read',
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableRequestLogging: process.env.CONSUL_LOG_REQUESTS === 'true',
    enableResponseLogging: process.env.CONSUL_LOG_RESPONSES === 'true',
  },

  // Retry configuration
  retry: {
    retries: parseInt(process.env.CONSUL_RETRIES) || 3,
    factor: parseFloat(process.env.CONSUL_RETRY_FACTOR) || 2,
    minTimeout: parseInt(process.env.CONSUL_RETRY_MIN_TIMEOUT) || 1000,
    maxTimeout: parseInt(process.env.CONSUL_RETRY_MAX_TIMEOUT) || 30000,
    randomize: process.env.CONSUL_RETRY_RANDOMIZE !== 'false',
  },

  // Circuit breaker configuration
  circuitBreaker: {
    enabled: process.env.CIRCUIT_BREAKER_ENABLED === 'true',
    timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 5000,
    errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD) || 50,
    requestVolumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_REQUEST_THRESHOLD) || 20,
    sleepWindow: parseInt(process.env.CIRCUIT_BREAKER_SLEEP_WINDOW) || 5000,
  },

  // Environment-specific overrides
  environments: {
    development: {
      consul: {
        host: 'localhost',
        port: 8500,
        secure: false,
      },
      healthCheck: {
        interval: '5s',
        timeout: '2s',
      },
      discovery: {
        watch: {
          enabled: true,
          method: 'longpoll',
        },
      },
    },
    
    staging: {
      consul: {
        host: process.env.CONSUL_STAGING_HOST || 'consul-staging.internal',
        port: 8500,
        secure: true,
      },
      healthCheck: {
        interval: '10s',
        timeout: '5s',
      },
      service: {
        tags: ['staging', 'api'],
      },
    },
    
    production: {
      consul: {
        host: process.env.CONSUL_PROD_HOST || 'consul.internal',
        port: 8500,
        secure: true,
        token: process.env.CONSUL_PROD_TOKEN,
      },
      healthCheck: {
        interval: '15s',
        timeout: '5s',
        deregisterCriticalServiceAfter: '1m',
      },
      service: {
        tags: ['production', 'api'],
      },
      discovery: {
        loadBalancing: {
          strategy: 'least-connections',
          healthyOnly: true,
          maxRetries: 5,
        },
      },
      circuitBreaker: {
        enabled: true,
        timeout: 3000,
        errorThresholdPercentage: 30,
        requestVolumeThreshold: 50,
      },
    },
  },

  // Service-specific configurations
  services: {
    'auth-service': {
      port: 3001,
      healthPath: '/health',
      tags: ['auth', 'security', 'api'],
      meta: {
        protocol: 'http',
        capability: 'authentication',
      },
    },
    
    'user-management-service': {
      port: 3002,
      healthPath: '/health',
      tags: ['users', 'management', 'api'],
      meta: {
        protocol: 'http',
        capability: 'user-management',
      },
    },
    
    'ai-routing-service': {
      port: 3003,
      healthPath: '/health',
      tags: ['ai', 'routing', 'llm', 'api'],
      meta: {
        protocol: 'http',
        capability: 'ai-routing',
      },
    },
    
    'billing-service': {
      port: 3004,
      healthPath: '/health',
      tags: ['billing', 'payments', 'api'],
      meta: {
        protocol: 'http',
        capability: 'billing',
      },
    },
    
    'plugin-manager-service': {
      port: 3005,
      healthPath: '/health',
      tags: ['plugins', 'management', 'api'],
      meta: {
        protocol: 'http',
        capability: 'plugin-management',
      },
    },
    
    'notification-service': {
      port: 3006,
      healthPath: '/health',
      tags: ['notifications', 'messaging', 'websocket', 'api'],
      meta: {
        protocol: 'http',
        capability: 'notifications',
        websocket: 'true',
      },
    },
  },
};
