
import React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '../components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    template: '%s | AI Employee Platform',
    default: 'AI Employee Platform'
  },
  description: 'AI Employee Platform - Your gateway to intelligent AI assistance and automation',
  keywords: ['AI', 'Employee Platform', 'Portal', 'AI Agents', 'Automation'],
  authors: [{ name: 'AI Employee Platform Team' }],
  creator: 'AI Employee Platform',
  publisher: 'AI Employee Platform',
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
