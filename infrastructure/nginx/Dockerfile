
# AI Employee Platform - Production Nginx Gateway
FROM nginx:1.24-alpine

# Install required packages for SSL and monitoring
RUN apk add --no-cache \
    curl \
    openssl \
    ca-certificates \
    tzdata

# Create directory structure
RUN mkdir -p \
    /etc/nginx/ssl \
    /var/log/nginx \
    /var/www/certbot \
    /etc/nginx/conf.d/templates

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy SSL certificate generation script
COPY generate-ssl.sh /usr/local/bin/generate-ssl.sh
RUN chmod +x /usr/local/bin/generate-ssl.sh

# Copy startup script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create nginx user for security
RUN adduser -D -s /bin/sh nginx-user

# Set timezone
ENV TZ=UTC

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -k -f https://localhost/health || curl -f http://localhost/health || exit 1

# Expose ports
EXPOSE 80 443

# Use custom entrypoint to handle SSL certificate generation
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
