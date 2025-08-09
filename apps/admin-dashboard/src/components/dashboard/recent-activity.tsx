
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { formatDistanceToNow } from 'date-fns'

interface Activity {
  id: string
  user: string
  action: string
  target: string
  status: 'success' | 'warning' | 'error'
  timestamp: Date
}

export function RecentActivity() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate API call - replace with real API
    const loadActivities = async () => {
      await new Promise(resolve => setTimeout(resolve, 800))
      
      const mockActivities: Activity[] = [
        {
          id: '1',
          user: 'john.doe@company.com',
          action: 'Created AI Agent',
          target: 'GPT-4 Assistant',
          status: 'success',
          timestamp: new Date(Date.now() - 5 * 60 * 1000)
        },
        {
          id: '2',
          user: 'jane.smith@company.com',
          action: 'Updated User Role',
          target: 'Employee → Admin',
          status: 'warning',
          timestamp: new Date(Date.now() - 15 * 60 * 1000)
        },
        {
          id: '3',
          user: 'bob.wilson@company.com',
          action: 'Failed Login Attempt',
          target: 'Admin Portal',
          status: 'error',
          timestamp: new Date(Date.now() - 30 * 60 * 1000)
        },
        {
          id: '4',
          user: 'alice.brown@company.com',
          action: 'Added Credits',
          target: '1000 Credits',
          status: 'success',
          timestamp: new Date(Date.now() - 45 * 60 * 1000)
        },
        {
          id: '5',
          user: 'charlie.davis@company.com',
          action: 'Deployed Plugin',
          target: 'Document Analyzer v2.0',
          status: 'success',
          timestamp: new Date(Date.now() - 60 * 60 * 1000)
        }
      ]
      
      setActivities(mockActivities)
      setLoading(false)
    }

    loadActivities()
  }, [])

  const getStatusBadgeVariant = (status: Activity['status']) => {
    switch (status) {
      case 'success':
        return 'default'
      case 'warning':
        return 'secondary'
      case 'error':
        return 'destructive'
      default:
        return 'default'
    }
  }

  const getUserInitials = (email: string) => {
    const [name] = email.split('@')
    const parts = name.split('.')
    return parts.map(part => part[0]?.toUpperCase()).join('').slice(0, 2)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          Latest actions and events across the platform
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {loading ? (
            // Loading skeleton
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <div className="animate-pulse bg-gray-300 w-10 h-10 rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="animate-pulse bg-gray-300 h-4 w-3/4 rounded"></div>
                  <div className="animate-pulse bg-gray-300 h-3 w-1/2 rounded"></div>
                </div>
              </div>
            ))
          ) : (
            activities.map((activity) => (
              <div key={activity.id} className="flex items-center space-x-4">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>
                    {getUserInitials(activity.user)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium leading-none">
                      {activity.user}
                    </p>
                    <Badge variant={getStatusBadgeVariant(activity.status)} className="text-xs">
                      {activity.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {activity.action}: <span className="font-medium">{activity.target}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
