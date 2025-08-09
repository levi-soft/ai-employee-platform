

import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '@ai-platform/shared-utils';
import type { User, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../types';

export class UserModel {
  /**
   * Create a new user
   */
  static async create(userData: {
    email: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: Role;
    language?: string;
    timezone?: string;
    isEmailVerified?: boolean;
    avatar?: string;
    oauthProvider?: string;
    oauthId?: string;
  }): Promise<User> {
    const hashedPassword = userData.password ? await hashPassword(userData.password) : null;

    return prisma.user.create({
      data: {
        email: userData.email.toLowerCase(),
        passwordHash: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role || 'EMPLOYEE',
        language: userData.language || 'vi',
        timezone: userData.timezone || 'Asia/Ho_Chi_Minh',
        isEmailVerified: userData.isEmailVerified || false,
        avatarUrl: userData.avatar,
        oauthProvider: userData.oauthProvider,
        oauthId: userData.oauthId,
        creditAccount: {
          create: {
            balance: 0.00,
            totalSpent: 0.00,
            totalToppedUp: 0.00,
          },
        },
      },
      include: {
        creditAccount: true,
      },
    });
  }

  /**
   * Find user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { 
        email: email.toLowerCase(),
        isActive: true,
      },
    });
  }

  /**
   * Find user by ID
   */
  static async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { 
        id,
        isActive: true,
      },
    });
  }

  /**
   * Verify user password
   */
  static async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) {
      return false; // OAuth-only users don't have passwords
    }
    return comparePassword(password, user.passwordHash);
  }

  /**
   * Update user password
   */
  static async updatePassword(userId: string, newPassword: string): Promise<User> {
    const hashedPassword = await hashPassword(newPassword);
    
    return prisma.user.update({
      where: { id: userId },
      data: { 
        passwordHash: hashedPassword,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Generic update method
   */
  static async update(
    userId: string,
    updateData: {
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
      language?: string;
      timezone?: string;
      isEmailVerified?: boolean;
      emailVerifiedAt?: Date;
      oauthProvider?: string | null;
      oauthId?: string | null;
      password?: string;
      passwordChangedAt?: Date;
    }
  ): Promise<User> {
    const data: any = { ...updateData };
    
    // Hash password if provided
    if (updateData.password) {
      data.passwordHash = await hashPassword(updateData.password);
      delete data.password;
    }
    
    data.updatedAt = new Date();

    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  /**
   * Update user profile
   */
  static async updateProfile(
    userId: string, 
    profileData: {
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
      language?: string;
      timezone?: string;
    }
  ): Promise<User> {
    return this.update(userId, profileData);
  }

  /**
   * Update user role (admin only)
   */
  static async updateRole(userId: string, role: Role): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { 
        role,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Deactivate user
   */
  static async deactivate(userId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { 
        isActive: false,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Reactivate user
   */
  static async reactivate(userId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { 
        isActive: true,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get all users with pagination
   */
  static async findMany(
    options: {
      page?: number;
      limit?: number;
      role?: Role;
      search?: string;
    } = {}
  ) {
    const { page = 1, limit = 20, role, search } = options;
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
    };

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          avatarUrl: true,
          language: true,
          timezone: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: skip + users.length < total,
      },
    };
  }

  /**
   * Check if user exists by email
   */
  static async existsByEmail(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    return !!user;
  }

  /**
   * Convert User to AuthenticatedUser
   */
  static toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      role: user.role,
      avatarUrl: user.avatarUrl || undefined,
      language: user.language,
      timezone: user.timezone,
      isActive: user.isActive,
    };
  }

  /**
   * Get user statistics
   */
  static async getStats() {
    const [totalUsers, activeUsers, adminUsers, employeeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: 'ADMIN', isActive: true } }),
      prisma.user.count({ where: { role: 'EMPLOYEE', isActive: true } }),
    ]);

    return {
      total: totalUsers,
      active: activeUsers,
      admins: adminUsers,
      employees: employeeUsers,
    };
  }
}

