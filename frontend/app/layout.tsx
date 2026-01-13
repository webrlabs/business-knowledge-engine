import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'
import { ThemeProvider } from '@/components/ThemeProvider'
import TelemetryProvider from '@/components/TelemetryProvider'
import CommandPalette from '@/components/CommandPalette'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Business Process Knowledge Platform',
  description: 'Intelligent Business Process Knowledge Platform - Enterprise Azure Edition',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ThemeProvider>
          <TelemetryProvider>
            <AuthProvider>
              {children}
              <CommandPalette />
              <KeyboardShortcuts />
            </AuthProvider>
          </TelemetryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
