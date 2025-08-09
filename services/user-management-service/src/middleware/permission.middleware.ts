
import { Request, Response, NextFunction } from 'express'
import { ROLE_PERMISSIONS, UserPermission } from '../models/user-profile.model'
import { logger } from '@ai-platform/shared-utils'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'ADMIN' | 'EMPLOYEE'
    isActive: boolean
  }
}

export class PermissionMiddleware {
  // Check if user has specific permission
  static hasPermission(resource: string, action: string) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.user
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          })
        }

        if (!user.isActive) {
          return res.status(403).json({
            success: false,
            error: 'Account is deactivated'
          })
        }

        const userRole = ROLE_PERMISSIONS[user.role]
        if (!userRole) {
          return res.status(403).json({
            success: false,
            error: 'Invalid user role'
          })
        }

        // Check if user has permission for this resource and action
        const hasPermission = userRole.permissions.some((permission: UserPermission) => 
          permission.resource === resource && 
          permission.actions.includes(action)
        )

        if (!hasPermission) {
          logger.warn('Permission denied', {
            userId: user.id,
            role: user.role,
            resource,
            action,
            requestId: req.id
          })

          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions'
          })
        }

        // Check conditions if they exist
        const permission = userRole.permissions.find((p: UserPermission) => 
          p.resource === resource && p.actions.includes(action)
        )

        if (permission?.conditions) {
          const conditionPassed = PermissionMiddleware.checkConditions(
            permission.conditions,
            req,
            user
          )

          if (!conditionPassed) {
            logger.warn('Permission condition failed', {
              userId: user.id,
              resource,
              action,
              conditions: permission.conditions,
              requestId: req.id
            })

            return res.status(403).json({
              success: false,
              error: 'Permission condition not met'
            })
          }
        }

        logger.info('Permission granted', {
          userId: user.id,
          role: user.role,
          resource,
          action,
          requestId: req.id
        })

        next()
      } catch (error) {
        logger.error('Error checking permissions', {
          userId: req.user?.id,
          resource,
          action,
          error: error instanceof Error ? error.message : 'Unknown error',
          requestId: req.id
        })

        res.status(500).json({
          success: false,
          error: 'Internal server error'
        })
      }
    }
  }

  // Check permission conditions
  private static checkConditions(
    conditions: Record<string, any>,
    req: AuthenticatedRequest,
    user: any
  ): boolean {
    // Own profile only condition
    if (conditions.own_profile_only) {
      const targetUserId = req.params.id || req.params.userId
      if (targetUserId && targetUserId !== user.id) {
        return false
      }
    }

    // Own account only condition
    if (conditions.own_account_only) {
      const targetUserId = req.params.id || req.params.userId || req.body.userId
      if (targetUserId && targetUserId !== user.id) {
        return false
      }
    }

    // Approved plugins only condition
    if (conditions.approved_plugins_only) {
      // This would check if the plugin is approved in the marketplace
      // For now, we'll assume all plugins accessed through this API are approved
      return true
    }

    return true
  }

  // Admin only middleware
  static adminOnly() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const user = req.user
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        })
      }

      if (user.role !== 'ADMIN') {
        logger.warn('Admin access denied', {
          userId: user.id,
          role: user.role,
          requestId: req.id
        })

        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        })
      }

      next()
    }
  }

  // Self or admin middleware (user can access own data or admin can access any)
  static selfOrAdmin() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const user = req.user
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        })
      }

      const targetUserId = req.params.id || req.params.userId
      
      // Admin can access any user's data
      if (user.role === 'ADMIN') {
        return next()
      }

      // Users can only access their own data
      if (targetUserId && targetUserId === user.id) {
        return next()
      }

      logger.warn('Self or admin access denied', {
        userId: user.id,
        targetUserId,
        role: user.role,
        requestId: req.id
      })

      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only access your own data.'
      })
    }
  }

  // Check if user can modify target user
  static canModifyUser() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const user = req.user
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        })
      }

      const targetUserId = req.params.id

      // Admin can modify any user except they can't demote themselves
      if (user.role === 'ADMIN') {
        if (targetUserId === user.id && req.body.role && req.body.role !== 'ADMIN') {
          return res.status(403).json({
            success: false,
            error: 'Cannot demote your own admin role'
          })
        }
        return next()
      }

      // Regular users can only modify their own profile (limited fields)
      if (targetUserId === user.id) {
        // Check if trying to modify restricted fields
        const restrictedFields = ['role', 'isActive', 'emailVerified']
        const hasRestrictedField = restrictedFields.some(field => 
          req.body.hasOwnProperty(field)
        )

        if (hasRestrictedField) {
          return res.status(403).json({
            success: false,
            error: 'Cannot modify restricted fields'
          })
        }

        return next()
      }

      logger.warn('User modification access denied', {
        userId: user.id,
        targetUserId,
        role: user.role,
        requestId: req.id
      })

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to modify this user'
      })
    }
  }

  // Log permission check for audit
  static logPermissionCheck(resource: string, action: string) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      logger.info('Permission check initiated', {
        userId: req.user?.id,
        role: req.user?.role,
        resource,
        action,
        method: req.method,
        path: req.path,
        requestId: req.id
      })

      next()
    }
  }
}

// Convenience middleware functions
export const hasPermission = PermissionMiddleware.hasPermission
export const adminOnly = PermissionMiddleware.adminOnly
export const selfOrAdmin = PermissionMiddleware.selfOrAdmin
export const canModifyUser = PermissionMiddleware.canModifyUser
export const logPermissionCheck = PermissionMiddleware.logPermissionCheck
