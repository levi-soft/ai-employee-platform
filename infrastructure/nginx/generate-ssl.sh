
#!/bin/sh

# AI Employee Platform - SSL Certificate Generator
# Generates self-signed certificates for development and testing

SSL_DIR="/etc/nginx/ssl"
DOMAIN="ai-employee-platform.local"

echo "Generating SSL certificates for AI Employee Platform Gateway..."

# Create SSL directory if it doesn't exist
mkdir -p "$SSL_DIR"

# Generate private key
echo "Generating private key..."
openssl genrsa -out "$SSL_DIR/server.key" 2048

# Generate certificate signing request
echo "Generating certificate signing request..."
openssl req -new -key "$SSL_DIR/server.key" -out "$SSL_DIR/server.csr" -subj "/C=US/ST=CA/L=San Francisco/O=AI Employee Platform/CN=$DOMAIN/subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

# Generate self-signed certificate
echo "Generating self-signed certificate..."
openssl x509 -req -days 365 -in "$SSL_DIR/server.csr" -signkey "$SSL_DIR/server.key" -out "$SSL_DIR/server.crt" -extensions v3_req -extfile <(
cat <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = localhost
DNS.3 = *.ai-employee-platform.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF
)

# Generate default certificate for unknown hosts
echo "Generating default certificate for security..."
openssl req -x509 -newkey rsa:2048 -keyout "$SSL_DIR/default.key" -out "$SSL_DIR/default.crt" -days 1 -nodes -subj "/CN=invalid"

# Clean up CSR file
rm "$SSL_DIR/server.csr"

# Set proper permissions
chmod 600 "$SSL_DIR"/*.key
chmod 644 "$SSL_DIR"/*.crt

echo "SSL certificates generated successfully!"
echo "Certificate: $SSL_DIR/server.crt"
echo "Private Key: $SSL_DIR/server.key"
echo "Domain: $DOMAIN"
echo ""
echo "To use HTTPS locally, add this to your /etc/hosts file:"
echo "127.0.0.1 $DOMAIN"
echo ""
echo "Note: This is a self-signed certificate for development only."
echo "For production, use certificates from a trusted CA."
