
#!/bin/sh
set -e

echo "Starting AI Employee Platform API Gateway..."

# Check if SSL certificates exist, if not generate them
if [ ! -f /etc/nginx/ssl/server.crt ] || [ ! -f /etc/nginx/ssl/server.key ]; then
    echo "SSL certificates not found. Generating self-signed certificates..."
    /usr/local/bin/generate-ssl.sh
fi

# Check if DH parameters exist, if not generate them
if [ ! -f /etc/nginx/ssl/dhparam.pem ]; then
    echo "Generating Diffie-Hellman parameters..."
    openssl dhparam -out /etc/nginx/ssl/dhparam.pem 2048
fi

# Test nginx configuration
echo "Testing nginx configuration..."
nginx -t

# Start nginx
echo "Starting nginx..."
exec "$@"
