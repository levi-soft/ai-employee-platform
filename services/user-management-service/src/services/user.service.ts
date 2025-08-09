
import { PrismaClient, User, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { logger } from '@ai-platform/shared-utils'

const prisma = new PrismaClient()

export interface CreateUserData {
  name: string
  email: string
  password?: string
  role?: Role
  isActive?: boolean
}

export interface UpdateUserData {
  name?: string
  email?: string
  password?: string
  isActive?: boolean
}

export interface UserFilter {
  search?: string
  role?: string
  status?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginationOptions {
  page: number
  limit: number
  filters?: UserFilter
}

export interface ActivityFilter {
  page: number
  limit: number
  type?: string
}

export class UserService {
  // Get all users with pagination and filtering
  async getAllUsers(options: PaginationOptions) {
    const { page, limit, filters = {} } = options
    const offset = (page - 1) * limit

    // Build where clause for filtering
    const where: any = {}
    
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } }
      ]
    }
    
    if (filters.role) {
      where.role = filters.role
    }
    
    if (filters.status === 'active') {
      where.isActive = true
    } else if (filters.status === 'inactive') {
      where.isActive = false
    }

    // Build order by clause
    const orderBy: any = {}
    if (filters.sortBy && filters.sortOrder) {
      orderBy[filters.sortBy] = filters.sortOrder
    } else {
      orderBy.createdAt = 'desc'
    }

    try {
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy,
          skip: offset,
          take: limit,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            emailVerified: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            creditAccount: {
              select: {
                balance: true,
                totalUsed: true
              }
            }
          }
        }),
        prisma.user.count({ where })
      ])

      const pages = Math.ceil(total / limit)

      return {
        data: users,
        total,
        page,
        pages,
        limit
      }
    } catch (error) {
      logger.error('Error retrieving users from database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
        pagination: { page, limit }
      })
      throw new Error('Failed to retrieve users')
    }
  }

  // Get user by ID
  async getUserById(id: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
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
          aiRequests: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              agentId: true,
              tokensUsed: true,
              cost: true,
              createdAt: true
            }
          }
        }
      })

      return user
    } catch (error) {
      logger.error('Error retrieving user by ID', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to retrieve user')
    }
  }

  // Create new user
  async createUser(userData: CreateUserData) {
    try {
      const { name, email, password, role = 'EMPLOYEE', isActive = true } = userData

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      })

      if (existingUser) {
        throw new Error('User with this email already exists')
      }

      // Hash password if provided
      let hashedPassword = null
      if (password) {
        const saltRounds = 12
        hashedPassword = await bcrypt.hash(password, saltRounds)
      }

      // Create user with credit account
      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
          isActive,
          creditAccount: {
            create: {
              balance: role === 'ADMIN' ? 10000 : 1000, // Admin gets more initial credits
              totalUsed: 0
            }
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          creditAccount: {
            select: {
              balance: true,
              totalUsed: true
            }
          }
        }
      })

      logger.info('User created successfully in database', {
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role
      })

      return newUser
    } catch (error) {
      logger.error('Error creating user', {
        email: userData.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error instanceof Error ? error : new Error('Failed to create user')
    }
  }

  // Update user
  async updateUser(id: string, updateData: UpdateUserData) {
    try {
      const user = await prisma.user.findUnique({ where: { id } })
      if (!user) {
        return null
      }

      const updatePayload: any = { ...updateData }

      // Hash password if provided
      if (updateData.password) {
        const saltRounds = 12
        updatePayload.password = await bcrypt.hash(updateData.password, saltRounds)
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updatePayload,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          emailVerified: true,
          updatedAt: true,
          creditAccount: {
            select: {
              balance: true,
              totalUsed: true
            }
          }
        }
      })

      logger.info('User updated successfully in database', {
        userId: id,
        updatedFields: Object.keys(updateData)
      })

      return updatedUser
    } catch (error) {
      logger.error('Error updating user', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to update user')
    }
  }

  // Delete user (soft delete)
  async deleteUser(id: string) {
    try {
      const user = await prisma.user.findUnique({ where: { id } })
      if (!user) {
        return false
      }

      await prisma.user.update({
        where: { id },
        data: { isActive: false }
      })

      logger.info('User soft deleted successfully', {
        userId: id
      })

      return true
    } catch (error) {
      logger.error('Error deleting user', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to delete user')
    }
  }

  // Update user role
  async updateUserRole(id: string, role: Role) {
    try {
      const user = await prisma.user.findUnique({ where: { id } })
      if (!user) {
        return null
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { role },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          updatedAt: true
        }
      })

      logger.info('User role updated successfully', {
        userId: id,
        oldRole: user.role,
        newRole: role
      })

      return updatedUser
    } catch (error) {
      logger.error('Error updating user role', {
        userId: id,
        role,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to update user role')
    }
  }

  // Get user activity
  async getUserActivity(id: string, options: ActivityFilter) {
    try {
      const { page, limit, type } = options
      const offset = (page - 1) * limit

      // Build where clause for activity filtering
      const where: any = { userId: id }
      
      if (type) {
        where.activityType = type
      }

      const [activities, total] = await Promise.all([
        prisma.aiRequest.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
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
        }),
        prisma.aiRequest.count({ where: { userId: id } })
      ])

      const pages = Math.ceil(total / limit)

      return {
        activities,
        total,
        page,
        pages,
        limit
      }
    } catch (error) {
      logger.error('Error retrieving user activity', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to retrieve user activity')
    }
  }

  // Search users
  async searchUsers(query: string, limit: number = 10) {
    try {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } }
          ],
          isActive: true
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        },
        take: limit
      })

      return users
    } catch (error) {
      logger.error('Error searching users', {
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to search users')
    }
  }

  // Get user statistics
  async getUserStats() {
    try {
      const [totalUsers, activeUsers, adminUsers, employeeUsers] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.user.count({ where: { role: 'EMPLOYEE' } })
      ])

      return {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        admins: adminUsers,
        employees: employeeUsers
      }
    } catch (error) {
      logger.error('Error retrieving user statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to retrieve user statistics')
    }
  }
}
