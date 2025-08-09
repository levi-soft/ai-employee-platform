
import React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '../components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    template: '%s | AI Employee Platform Admin',
    default: 'AI Employee Platform Admin'
  },
  description: 'AI Employee Platform - Administrative Dashboard for managing AI agents, users, and platform operations',
  keywords: ['AI', 'Employee Platform', 'Admin Dashboard', 'AI Agents', 'Management'],
  authors: [{ name: 'AI Employee Platform Team' }],
  creator: 'AI Employee Platform',
  publisher: 'AI Employee Platform',
  robots: {
    index: false,
    follow: false,
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
