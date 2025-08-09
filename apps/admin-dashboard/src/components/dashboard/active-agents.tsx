
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Progress } from '../ui/progress'
import { Bot, Cpu, Zap } from 'lucide-react'

interface AIAgent {
  id: string
  name: string
  model: string
  status: 'active' | 'idle' | 'maintenance'
  requests: number
  maxRequests: number
  uptime: number
}

export function ActiveAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate API call - replace with real API
    const loadAgents = async () => {
      await new Promise(resolve => setTimeout(resolve, 600))
      
      const mockAgents: AIAgent[] = [
        {
          id: '1',
          name: 'GPT-4 Assistant',
          model: 'gpt-4',
          status: 'active',
          requests: 1247,
          maxRequests: 2000,
          uptime: 99.8
        },
        {
          id: '2',
          name: 'Claude 3 Analyzer',
          model: 'claude-3-opus',
          status: 'active',
          requests: 892,
          maxRequests: 1500,
          uptime: 99.2
        },
        {
          id: '3',
          name: 'Code Assistant',
          model: 'gpt-3.5-turbo',
          status: 'idle',
          requests: 456,
          maxRequests: 1000,
          uptime: 98.9
        },
        {
          id: '4',
          name: 'Document Processor',
          model: 'gemini-pro',
          status: 'maintenance',
          requests: 0,
          maxRequests: 800,
          uptime: 0
        }
      ]
      
      setAgents(mockAgents)
      setLoading(false)
    }

    loadAgents()
  }, [])

  const getStatusBadge = (status: AIAgent['status']) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>
      case 'idle':
        return <Badge className="bg-yellow-100 text-yellow-800">Idle</Badge>
      case 'maintenance':
        return <Badge className="bg-red-100 text-red-800">Maintenance</Badge>
      default:
        return <Badge>Unknown</Badge>
    }
  }

  const getStatusIcon = (status: AIAgent['status']) => {
    switch (status) {
      case 'active':
        return <Zap className="h-4 w-4 text-green-600" />
      case 'idle':
        return <Cpu className="h-4 w-4 text-yellow-600" />
      case 'maintenance':
        return <Bot className="h-4 w-4 text-red-600" />
      default:
        return <Bot className="h-4 w-4 text-gray-600" />
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active AI Agents</CardTitle>
        <CardDescription>
          Current status and performance of AI agents
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {loading ? (
            // Loading skeleton
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="animate-pulse bg-gray-300 h-4 w-32 rounded"></div>
                  <div className="animate-pulse bg-gray-300 h-5 w-16 rounded"></div>
                </div>
                <div className="animate-pulse bg-gray-300 h-2 w-full rounded"></div>
                <div className="flex justify-between text-xs">
                  <div className="animate-pulse bg-gray-300 h-3 w-20 rounded"></div>
                  <div className="animate-pulse bg-gray-300 h-3 w-16 rounded"></div>
                </div>
              </div>
            ))
          ) : (
            agents.map((agent) => (
              <div key={agent.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(agent.status)}
                    <div>
                      <p className="text-sm font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.model}</p>
                    </div>
                  </div>
                  {getStatusBadge(agent.status)}
                </div>
                
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Requests: {agent.requests.toLocaleString()}/{agent.maxRequests.toLocaleString()}</span>
                    <span>{Math.round((agent.requests / agent.maxRequests) * 100)}%</span>
                  </div>
                  <Progress 
                    value={(agent.requests / agent.maxRequests) * 100} 
                    className="h-2"
                  />
                </div>
                
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Uptime: {agent.uptime}%</span>
                  <span className="text-green-600">●</span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
