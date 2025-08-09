
import { PrismaClient } from '@prisma/client'
import { logger } from '@ai-platform/shared-utils'

const prisma = new PrismaClient()

export interface ProfileUpdateData {
  name?: string
  bio?: string
  avatar?: string
  preferences?: {
    theme?: 'light' | 'dark' | 'system'
    notifications?: {
      email?: boolean
      push?: boolean
      sms?: boolean
    }
    defaultAgent?: string
  }
}

export interface NotificationPreferences {
  email: boolean
  push: boolean
  sms: boolean
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  notifications: NotificationPreferences
  defaultAgent?: string
}

export class ProfileService {
  // Get user profile
  async getUserProfile(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
          bio: true,
          avatar: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
          preferences: true,
          creditAccount: {
            select: {
              balance: true,
              totalUsed: true,
              budgetLimits: {
                select: {
                  id: true,
                  limitType: true,
                  amount: true,
                  period: true,
                  isActive: true
                }
              }
            }
          },
          _count: {
            select: {
              aiRequests: true,
              userPlugins: true
            }
          }
        }
      })

      if (!user) {
        return null
      }

      // Parse preferences JSON if exists
      let preferences: UserPreferences = {
        theme: 'system',
        notifications: {
          email: true,
          push: true,
          sms: false
        }
      }

      if (user.preferences) {
        try {
          preferences = { ...preferences, ...JSON.parse(user.preferences as string) }
        } catch (error) {
          logger.warn('Failed to parse user preferences JSON', {
            userId,
            preferences: user.preferences
          })
        }
      }

      return {
        ...user,
        preferences,
        stats: {
          totalRequests: user._count.aiRequests,
          pluginsInstalled: user._count.userPlugins
        }
      }
    } catch (error) {
      logger.error('Error retrieving user profile', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to retrieve user profile')
    }
  }

  // Update user profile
  async updateUserProfile(userId: string, updateData: ProfileUpdateData) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) {
        throw new Error('User not found')
      }

      const updatePayload: any = {}
      
      if (updateData.name) updatePayload.name = updateData.name
      if (updateData.bio !== undefined) updatePayload.bio = updateData.bio
      if (updateData.avatar !== undefined) updatePayload.avatar = updateData.avatar

      // Handle preferences update
      if (updateData.preferences) {
        let existingPreferences: any = {}
        
        if (user.preferences) {
          try {
            existingPreferences = JSON.parse(user.preferences as string)
          } catch (error) {
            logger.warn('Failed to parse existing preferences', {
              userId,
              preferences: user.preferences
            })
          }
        }

        // Merge preferences
        const mergedPreferences = {
          ...existingPreferences,
          ...updateData.preferences
        }

        updatePayload.preferences = JSON.stringify(mergedPreferences)
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updatePayload,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          bio: true,
          avatar: true,
          preferences: true,
          updatedAt: true
        }
      })

      // Parse preferences for response
      let preferences: UserPreferences = {
        theme: 'system',
        notifications: {
          email: true,
          push: true,
          sms: false
        }
      }

      if (updatedUser.preferences) {
        try {
          preferences = { ...preferences, ...JSON.parse(updatedUser.preferences as string) }
        } catch (error) {
          logger.warn('Failed to parse updated preferences JSON', {
            userId,
            preferences: updatedUser.preferences
          })
        }
      }

      logger.info('User profile updated successfully', {
        userId,
        updatedFields: Object.keys(updateData)
      })

      return {
        ...updatedUser,
        preferences
      }
    } catch (error) {
      logger.error('Error updating user profile', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error instanceof Error ? error : new Error('Failed to update user profile')
    }
  }

  // Update notification preferences
  async updateNotificationPreferences(userId: string, preferences: NotificationPreferences) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) {
        throw new Error('User not found')
      }

      // Get existing preferences
      let existingPreferences: any = {}
      
      if (user.preferences) {
        try {
          existingPreferences = JSON.parse(user.preferences as string)
        } catch (error) {
          logger.warn('Failed to parse existing notification preferences', {
            userId,
            preferences: user.preferences
          })
        }
      }

      // Update notification preferences
      const updatedPreferences = {
        ...existingPreferences,
        notifications: preferences
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          preferences: JSON.stringify(updatedPreferences)
        }
      })

      logger.info('Notification preferences updated successfully', {
        userId,
        preferences
      })

      return preferences
    } catch (error) {
      logger.error('Error updating notification preferences', {
        userId,
        preferences,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error instanceof Error ? error : new Error('Failed to update notification preferences')
    }
  }

  // Get user activity summary
  async getUserActivitySummary(userId: string) {
    try {
      const now = new Date()
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

      const [
        totalRequests,
        requests30Days,
        requests7Days,
        requestsToday,
        totalCost,
        cost30Days,
        recentRequests
      ] = await Promise.all([
        prisma.aiRequest.count({ where: { userId } }),
        prisma.aiRequest.count({ 
          where: { 
            userId, 
            createdAt: { gte: last30Days }
          }
        }),
        prisma.aiRequest.count({ 
          where: { 
            userId, 
            createdAt: { gte: last7Days }
          }
        }),
        prisma.aiRequest.count({ 
          where: { 
            userId, 
            createdAt: { gte: today }
          }
        }),
        prisma.aiRequest.aggregate({
          where: { userId },
          _sum: { cost: true }
        }),
        prisma.aiRequest.aggregate({
          where: { 
            userId, 
            createdAt: { gte: last30Days }
          },
          _sum: { cost: true }
        }),
        prisma.aiRequest.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            agentId: true,
            tokensUsed: true,
            cost: true,
            responseTime: true,
            createdAt: true,
            aiAgent: {
              select: {
                name: true,
                provider: true
              }
            }
          }
        })
      ])

      return {
        requests: {
          total: totalRequests,
          last30Days: requests30Days,
          last7Days: requests7Days,
          today: requestsToday
        },
        cost: {
          total: totalCost._sum.cost || 0,
          last30Days: cost30Days._sum.cost || 0
        },
        recentActivity: recentRequests
      }
    } catch (error) {
      logger.error('Error retrieving user activity summary', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to retrieve user activity summary')
    }
  }

  // Upload and update user avatar
  async updateUserAvatar(userId: string, avatarUrl: string) {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { avatar: avatarUrl },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          updatedAt: true
        }
      })

      logger.info('User avatar updated successfully', {
        userId,
        avatarUrl
      })

      return updatedUser
    } catch (error) {
      logger.error('Error updating user avatar', {
        userId,
        avatarUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to update user avatar')
    }
  }

  // Delete user avatar
  async deleteUserAvatar(userId: string) {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { avatar: null },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          updatedAt: true
        }
      })

      logger.info('User avatar deleted successfully', {
        userId
      })

      return updatedUser
    } catch (error) {
      logger.error('Error deleting user avatar', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to delete user avatar')
    }
  }
}
