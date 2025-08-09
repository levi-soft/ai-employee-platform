
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@ai-platform/shared-types', '@ai-platform/shared-utils', '@ai-platform/ui-components'],
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY || 'default-value',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8080/api/:path*',
      },
    ]
  },
  // Enable SWC minification for better performance
  swcMinify: true,
  
  // Optimize images
  images: {
    formats: ['image/webp', 'image/avif'],
  },
  
  // Enable compression
  compress: true,
}

module.exports = nextConfig
