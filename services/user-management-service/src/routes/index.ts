
import { Router } from 'express'
import { UserController } from '../controllers/user.controller'
import { authenticateToken, requireRole } from '@ai-platform/shared-utils'
import { hasPermission, adminOnly, selfOrAdmin, canModifyUser } from '../middleware/permission.middleware'
import { ProfileService } from '../services/profile.service'

const router = Router()
const userController = new UserController()
const profileService = new ProfileService()

// User CRUD routes
router.get('/users', 
  authenticateToken, 
  hasPermission('users', 'read'),
  userController.getUsers.bind(userController)
)

router.get('/users/search',
  authenticateToken,
  hasPermission('users', 'read'),
  userController.searchUsers.bind(userController)
)

router.get('/users/stats',
  authenticateToken,
  adminOnly(),
  async (req, res, next) => {
    try {
      const userService = userController['userService']
      const stats = await userService.getUserStats()
      res.json({ success: true, data: stats })
    } catch (error) {
      next(error)
    }
  }
)

router.get('/users/:id',
  authenticateToken,
  selfOrAdmin(),
  userController.getUserById.bind(userController)
)

router.post('/users',
  authenticateToken,
  hasPermission('users', 'create'),
  userController.createUser.bind(userController)
)

router.put('/users/:id',
  authenticateToken,
  canModifyUser(),
  userController.updateUser.bind(userController)
)

router.delete('/users/:id',
  authenticateToken,
  hasPermission('users', 'delete'),
  userController.deleteUser.bind(userController)
)

router.put('/users/:id/role',
  authenticateToken,
  hasPermission('users', 'manage_roles'),
  userController.updateUserRole.bind(userController)
)

router.get('/users/:id/activity',
  authenticateToken,
  selfOrAdmin(),
  userController.getUserActivity.bind(userController)
)

// Profile routes
router.get('/profile',
  authenticateToken,
  async (req: any, res, next) => {
    try {
      const profile = await profileService.getUserProfile(req.user.id)
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        })
      }
      res.json({ success: true, data: profile })
    } catch (error) {
      next(error)
    }
  }
)

router.put('/profile',
  authenticateToken,
  async (req: any, res, next) => {
    try {
      const updatedProfile = await profileService.updateUserProfile(req.user.id, req.body)
      res.json({ success: true, data: updatedProfile })
    } catch (error) {
      next(error)
    }
  }
)

router.get('/profile/:id',
  authenticateToken,
  selfOrAdmin(),
  async (req: any, res, next) => {
    try {
      const profile = await profileService.getUserProfile(req.params.id)
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        })
      }
      res.json({ success: true, data: profile })
    } catch (error) {
      next(error)
    }
  }
)

router.put('/profile/notifications',
  authenticateToken,
  async (req: any, res, next) => {
    try {
      const preferences = await profileService.updateNotificationPreferences(req.user.id, req.body)
      res.json({ success: true, data: preferences })
    } catch (error) {
      next(error)
    }
  }
)

router.get('/profile/:id/activity-summary',
  authenticateToken,
  selfOrAdmin(),
  async (req: any, res, next) => {
    try {
      const summary = await profileService.getUserActivitySummary(req.params.id)
      res.json({ success: true, data: summary })
    } catch (error) {
      next(error)
    }
  }
)

router.put('/profile/avatar',
  authenticateToken,
  async (req: any, res, next) => {
    try {
      const { avatarUrl } = req.body
      if (!avatarUrl) {
        return res.status(400).json({
          success: false,
          error: 'Avatar URL is required'
        })
      }
      const updatedUser = await profileService.updateUserAvatar(req.user.id, avatarUrl)
      res.json({ success: true, data: updatedUser })
    } catch (error) {
      next(error)
    }
  }
)

router.delete('/profile/avatar',
  authenticateToken,
  async (req: any, res, next) => {
    try {
      const updatedUser = await profileService.deleteUserAvatar(req.user.id)
      res.json({ success: true, data: updatedUser })
    } catch (error) {
      next(error)
    }
  }
)

export default router
