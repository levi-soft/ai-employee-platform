
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Users, Bot, CreditCard, TrendingUp, Activity } from 'lucide-react'

interface Stats {
  totalUsers: number
  activeAgents: number
  totalCredits: number
  monthlyRevenue: number
}

export function DashboardStats() {
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeAgents: 0,
    totalCredits: 0,
    monthlyRevenue: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate API call - replace with real API
    const loadStats = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      setStats({
        totalUsers: 1247,
        activeAgents: 24,
        totalCredits: 45678,
        monthlyRevenue: 12450
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const statsCards = [
    {
      title: 'Total Users',
      value: stats.totalUsers.toLocaleString(),
      change: '+12%',
      icon: Users,
      color: 'text-blue-600'
    },
    {
      title: 'Active AI Agents',
      value: stats.activeAgents.toString(),
      change: '+3',
      icon: Bot,
      color: 'text-green-600'
    },
    {
      title: 'Available Credits',
      value: stats.totalCredits.toLocaleString(),
      change: '+8%',
      icon: CreditCard,
      color: 'text-purple-600'
    },
    {
      title: 'Monthly Revenue',
      value: `$${stats.monthlyRevenue.toLocaleString()}`,
      change: '+15%',
      icon: TrendingUp,
      color: 'text-orange-600'
    }
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statsCards.map((stat, index) => (
        <Card key={stat.title} className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {stat.title}
            </CardTitle>
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <div className="animate-pulse bg-gray-300 h-8 w-16 rounded"></div>
              ) : (
                stat.value
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">{stat.change}</span> from last month
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
