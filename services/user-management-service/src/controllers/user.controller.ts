
import { Request, Response, NextFunction } from 'express'
import { UserService } from '../services/user.service'
import { ProfileService } from '../services/profile.service'
import { userValidationSchemas } from '@ai-platform/shared-utils'
import { logger } from '@ai-platform/shared-utils'

export class UserController {
  private userService: UserService
  private profileService: ProfileService

  constructor() {
    this.userService = new UserService()
    this.profileService = new ProfileService()
  }

  // Get all users with pagination and filtering
  async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 10,
        search = '',
        role,
        status,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query

      const filters = {
        search: search as string,
        role: role as string,
        status: status as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as 'asc' | 'desc'
      }

      const users = await this.userService.getAllUsers({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        filters
      })

      logger.info('Users retrieved successfully', {
        requestId: req.id,
        userId: req.user?.id,
        count: users.data.length,
        total: users.total,
        page: users.page
      })

      res.json({
        success: true,
        data: users.data,
        pagination: {
          total: users.total,
          page: users.page,
          pages: users.pages,
          limit: users.limit
        }
      })
    } catch (error) {
      logger.error('Error retrieving users', {
        requestId: req.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      })
      next(error)
    }
  }

  // Get single user by ID
  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      
      const user = await this.userService.getUserById(id)
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        })
      }

      logger.info('User retrieved successfully', {
        requestId: req.id,
        targetUserId: id,
        requesterId: req.user?.id
      })

      res.json({
        success: true,
        data: user
      })
    } catch (error) {
      logger.error('Error retrieving user', {
        requestId: req.id,
        targetUserId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Create new user
  async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const validationResult = userValidationSchemas.createUser.safeParse(req.body)
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationResult.error.issues
        })
      }

      const userData = validationResult.data
      const newUser = await this.userService.createUser(userData)

      logger.info('User created successfully', {
        requestId: req.id,
        newUserId: newUser.id,
        createdBy: req.user?.id,
        email: userData.email,
        role: userData.role
      })

      res.status(201).json({
        success: true,
        data: newUser
      })
    } catch (error) {
      logger.error('Error creating user', {
        requestId: req.id,
        createdBy: req.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Update user
  async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      const validationResult = userValidationSchemas.updateUser.safeParse(req.body)
      
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationResult.error.issues
        })
      }

      const updateData = validationResult.data
      const updatedUser = await this.userService.updateUser(id, updateData)

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        })
      }

      logger.info('User updated successfully', {
        requestId: req.id,
        targetUserId: id,
        updatedBy: req.user?.id,
        updatedFields: Object.keys(updateData)
      })

      res.json({
        success: true,
        data: updatedUser
      })
    } catch (error) {
      logger.error('Error updating user', {
        requestId: req.id,
        targetUserId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Delete user
  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      
      const deleted = await this.userService.deleteUser(id)
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        })
      }

      logger.info('User deleted successfully', {
        requestId: req.id,
        targetUserId: id,
        deletedBy: req.user?.id
      })

      res.json({
        success: true,
        message: 'User deleted successfully'
      })
    } catch (error) {
      logger.error('Error deleting user', {
        requestId: req.id,
        targetUserId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Update user role
  async updateUserRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      const { role } = req.body

      if (!role || !['ADMIN', 'EMPLOYEE'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role. Must be ADMIN or EMPLOYEE'
        })
      }

      const updatedUser = await this.userService.updateUserRole(id, role)
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        })
      }

      logger.info('User role updated successfully', {
        requestId: req.id,
        targetUserId: id,
        updatedBy: req.user?.id,
        newRole: role
      })

      res.json({
        success: true,
        data: updatedUser
      })
    } catch (error) {
      logger.error('Error updating user role', {
        requestId: req.id,
        targetUserId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Get user activity
  async getUserActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      const { page = 1, limit = 20, type } = req.query

      const activity = await this.userService.getUserActivity(id, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        type: type as string
      })

      res.json({
        success: true,
        data: activity.activities,
        pagination: {
          total: activity.total,
          page: activity.page,
          pages: activity.pages,
          limit: activity.limit
        }
      })
    } catch (error) {
      logger.error('Error retrieving user activity', {
        requestId: req.id,
        targetUserId: req.params.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }

  // Search users
  async searchUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { q, limit = 10 } = req.query
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Search query is required'
        })
      }

      const users = await this.userService.searchUsers(q, parseInt(limit as string))

      res.json({
        success: true,
        data: users,
        count: users.length
      })
    } catch (error) {
      logger.error('Error searching users', {
        requestId: req.id,
        query: req.query.q,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      next(error)
    }
  }
}
