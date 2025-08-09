# AI Employee Platform - Monitoring & Logging Infrastructure

This directory contains the complete monitoring and logging infrastructure for the AI Employee Platform, built on the ELK (Elasticsearch, Logstash, Kibana) stack with Filebeat for log collection.

## 📋 Overview

The monitoring and logging system provides:

- **Structured Logging**: JSON-based logs with consistent format across all services
- **Log Aggregation**: Centralized log collection using ELK stack
- **Real-time Analysis**: Kibana dashboards for log analysis and visualization
- **Health Monitoring**: Health check endpoints for all services
- **Metrics Collection**: Performance and business metrics
- **Alerting**: (Future enhancement) Alert system for critical events

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Microservices │    │   Filebeat   │    │   Logstash      │
│                 │────▶│              │────▶│                 │
│  - Auth Service │    │  Log Shipper │    │  Log Processing │
│  - AI Routing   │    │              │    │                 │
│  - Billing      │    └──────────────┘    └─────────────────┘
│  - User Mgmt    │                                 │
│  - Plugin Mgr   │                                 ▼
│  - Notifications│    ┌─────────────────┐    ┌─────────────────┐
│                 │    │     Kibana      │    │  Elasticsearch  │
│  Application    │◄───┤                 │◄───┤                 │
│  Logs           │    │  Visualization  │    │  Log Storage    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### 1. Setup Monitoring Infrastructure

```bash
# Run the setup script
./scripts/monitoring-setup.sh setup
```

This will:

- Pull required Docker images
- Start ELK stack services
- Configure Elasticsearch templates
- Setup Kibana index patterns
- Create necessary directories

### 2. Access Monitoring Services

- **Kibana Dashboard**: http://localhost:5601
- **Elasticsearch**: http://localhost:9200
- **Logstash**: http://localhost:9600

### 3. Integrate Services

Update your service code to use the structured logger:

```typescript
import { createServiceLogger, HealthChecker } from '@ai-platform/shared-utils'

const logger = createServiceLogger('your-service-name')

// Log structured data
logger.info('Operation completed', {
  userId: '12345',
  operation: 'user_login',
  duration: 150,
})
```

## 📁 Directory Structure

```
infrastructure/logging/
├── docker-compose.elk.yml          # ELK stack Docker Compose
├── elasticsearch/
│   └── config/
│       └── elasticsearch.yml       # Elasticsearch configuration
├── logstash/
│   ├── config/
│   │   └── logstash.yml           # Logstash configuration
│   └── pipeline/
│       └── logstash.conf          # Log processing pipeline
├── kibana/
│   └── config/
│       └── kibana.yml             # Kibana configuration
└── filebeat/
    └── config/
        └── filebeat.yml           # Filebeat configuration
```

## ⚙️ Configuration

### Environment Variables

Set these environment variables for full functionality:

```bash
# ELK Stack Configuration
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_HOST=localhost
ELASTICSEARCH_PORT=9200
ELASTICSEARCH_INDEX=ai-platform-logs
ELASTICSEARCH_SSL=false

# Logging Configuration
LOG_LEVEL=info
NODE_ENV=development
ENVIRONMENT=development

# Service Configuration
SERVICE_NAME=your-service-name
SERVICE_VERSION=1.0.0
```

### Logging Levels

- `error`: Error conditions
- `warn`: Warning conditions
- `info`: Informational messages (default)
- `debug`: Debug-level messages
- `verbose`: Verbose debug information

## 📊 Log Structure

All logs follow this structured JSON format:

```json
{
  "timestamp": "2025-08-08T12:34:56.789Z",
  "level": "info",
  "service": "auth-service",
  "message": "User login successful",
  "requestId": "req-12345-abcde",
  "userId": "user-67890",
  "operation": "user_login",
  "duration": 150,
  "statusCode": 200,
  "method": "POST",
  "url": "/api/auth/login",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "environment": "development",
  "platform": "ai-employee-platform"
}
```

## 🔍 Log Types

### HTTP Logs

- Request/response logging
- Performance metrics
- Error tracking

### Security Logs

- Authentication events
- Authorization failures
- Suspicious activities

### Business Logs

- User registrations
- Role changes
- Account operations

### Performance Logs

- Operation timing
- Resource usage
- Bottleneck identification

## 🎯 Health Checks

Each service exposes health check endpoints:

- **Endpoint**: `GET /health`
- **Response**: JSON health status
- **Checks**: Database, Redis, external services, memory

Example health check response:

```json
{
  "service": "auth-service",
  "status": "healthy",
  "timestamp": "2025-08-08T12:34:56.789Z",
  "version": "1.0.0",
  "uptime": 86400000,
  "checks": [
    {
      "name": "database",
      "status": "healthy",
      "message": "Database connected",
      "duration": 25,
      "critical": true
    }
  ]
}
```

## 📈 Metrics Collection

The system collects various metrics:

### Counter Metrics

- HTTP requests total
- Error occurrences
- Business events

### Histogram Metrics

- Request duration
- Operation timing
- Response sizes

### Gauge Metrics

- Memory usage
- Active connections
- Queue sizes

## 🛠️ Management Commands

```bash
# Setup monitoring infrastructure
./scripts/monitoring-setup.sh setup

# Start services
./scripts/monitoring-setup.sh start

# Stop services
./scripts/monitoring-setup.sh stop

# Restart services
./scripts/monitoring-setup.sh restart

# Check service status
./scripts/monitoring-setup.sh status

# View logs
./scripts/monitoring-setup.sh logs [service-name]

# Test setup
./scripts/monitoring-setup.sh test

# Clean all data (destructive)
./scripts/monitoring-setup.sh clean
```

## 📱 Kibana Usage

### 1. Index Patterns

Pre-configured index patterns:

- `ai-platform-logs-*`: Application logs
- `filebeat-ai-platform-*`: File-based logs

### 2. Common Queries

```
# View all errors
level: "error"

# View specific service logs
service: "auth-service"

# View user activity
userId: "user-12345"

# View slow requests
duration: >1000

# View HTTP errors
statusCode: >=400
```

### 3. Dashboard Creation

1. Open Kibana at http://localhost:5601
2. Go to "Visualize" to create charts
3. Go to "Dashboard" to combine visualizations
4. Save and share dashboards

## 🚨 Alerting (Future Enhancement)

Planned alerting features:

- Error rate thresholds
- Performance degradation
- Security event notifications
- Service health alerts

## 🔧 Troubleshooting

### Common Issues

1. **Elasticsearch not starting**

   ```bash
   # Check disk space
   df -h

   # Check memory
   free -h

   # Increase VM max map count (Linux)
   sudo sysctl -w vm.max_map_count=262144
   ```

2. **Logs not appearing**

   ```bash
   # Check Filebeat status
   docker-compose -f docker-compose.elk.yml logs filebeat

   # Check log directory permissions
   ls -la logs/
   ```

3. **Kibana connection issues**

   ```bash
   # Check Elasticsearch health
   curl http://localhost:9200/_cluster/health

   # Restart Kibana
   ./scripts/monitoring-setup.sh restart
   ```

### Log Files

- Application logs: `logs/`
- Elasticsearch logs: Container logs
- Logstash logs: Container logs
- Kibana logs: Container logs

## 🔐 Security Considerations

- ELK stack runs without authentication (development only)
- For production: Enable X-Pack security
- Log data contains sensitive information
- Regular log rotation and cleanup needed
- Network isolation for production deployments

## 📝 Contributing

When adding new services:

1. Use the structured logger from shared-utils
2. Implement health check endpoints
3. Add appropriate log context
4. Follow log level conventions
5. Include performance logging

## 📚 Further Reading

- [Elasticsearch Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- [Logstash Documentation](https://www.elastic.co/guide/en/logstash/current/index.html)
- [Kibana Documentation](https://www.elastic.co/guide/en/kibana/current/index.html)
- [Filebeat Documentation](https://www.elastic.co/guide/en/beats/filebeat/current/index.html)
