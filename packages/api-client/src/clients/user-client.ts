
// User management API client
import { BaseAPIClient } from './base-client';
import {
  User,
  UserListParams,
  UserProfile,
  PaginatedResponse
} from '@ai-platform/shared-types';
import { API_ROUTES } from '@ai-platform/shared-types';

export class UserClient extends BaseAPIClient {
  // User CRUD operations
  async getUsers(params?: UserListParams): Promise<PaginatedResponse<User>> {
    return this.getPaginated<User>(API_ROUTES.USERS.LIST, params);
  }

  async getUser(id: string): Promise<User> {
    const response = await this.get<User>(
      API_ROUTES.USERS.GET.replace(':id', id)
    );
    return response.data!;
  }

  async createUser(userData: {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    password?: string;
  }): Promise<User> {
    const response = await this.post<User>(API_ROUTES.USERS.CREATE, userData);
    return response.data!;
  }

  async updateUser(id: string, userData: Partial<User>): Promise<User> {
    const response = await this.patch<User>(
      API_ROUTES.USERS.UPDATE.replace(':id', id),
      userData
    );
    return response.data!;
  }

  async deleteUser(id: string): Promise<void> {
    await this.delete(API_ROUTES.USERS.DELETE.replace(':id', id));
  }

  // User search and filtering
  async searchUsers(query: string, filters?: Record<string, any>): Promise<User[]> {
    const response = await this.get<User[]>(API_ROUTES.USERS.SEARCH, {
      params: { query, ...filters },
    });
    return response.data!;
  }

  // User profile management
  async updateUserProfile(id: string, profile: UserProfile): Promise<User> {
    const response = await this.patch<User>(
      `${API_ROUTES.USERS.UPDATE.replace(':id', id)}/profile`,
      profile
    );
    return response.data!;
  }

  // User status management
  async activateUser(id: string): Promise<User> {
    const response = await this.post<User>(
      `${API_ROUTES.USERS.UPDATE.replace(':id', id)}/activate`
    );
    return response.data!;
  }

  async deactivateUser(id: string): Promise<User> {
    const response = await this.post<User>(
      `${API_ROUTES.USERS.UPDATE.replace(':id', id)}/deactivate`
    );
    return response.data!;
  }

  async suspendUser(id: string, reason?: string): Promise<User> {
    const response = await this.post<User>(
      `${API_ROUTES.USERS.UPDATE.replace(':id', id)}/suspend`,
      { reason }
    );
    return response.data!;
  }

  // User analytics
  async getUserStats(id: string): Promise<{
    totalRequests: number;
    totalSpent: number;
    averageResponseTime: number;
    favoriteAgents: Array<{ agentId: string; agentName: string; usage: number }>;
    monthlyUsage: Array<{ month: string; requests: number; cost: number }>;
  }> {
    const response = await this.get<{
      totalRequests: number;
      totalSpent: number;
      averageResponseTime: number;
      favoriteAgents: Array<{ agentId: string; agentName: string; usage: number }>;
      monthlyUsage: Array<{ month: string; requests: number; cost: number }>;
    }>(`${API_ROUTES.USERS.GET.replace(':id', id)}/stats`);
    
    return response.data!;
  }

  // Bulk operations
  async bulkUpdateUsers(
    userIds: string[],
    updates: Partial<User>
  ): Promise<{ updated: string[]; failed: string[] }> {
    const response = await this.patch<{ updated: string[]; failed: string[] }>(
      `${API_ROUTES.USERS.LIST}/bulk-update`,
      { userIds, updates }
    );
    return response.data!;
  }

  async bulkDeleteUsers(userIds: string[]): Promise<{ deleted: string[]; failed: string[] }> {
    const response = await this.delete<{ deleted: string[]; failed: string[] }>(
      `${API_ROUTES.USERS.LIST}/bulk-delete`,
      { data: { userIds } }
    );
    return response.data!;
  }

  // User preferences
  async getUserPreferences(id: string): Promise<{
    theme: 'light' | 'dark' | 'system';
    language: string;
    timezone: string;
    notifications: {
      email: boolean;
      push: boolean;
      marketing: boolean;
    };
  }> {
    const response = await this.get<{
      theme: 'light' | 'dark' | 'system';
      language: string;
      timezone: string;
      notifications: {
        email: boolean;
        push: boolean;
        marketing: boolean;
      };
    }>(`${API_ROUTES.USERS.GET.replace(':id', id)}/preferences`);
    
    return response.data!;
  }

  async updateUserPreferences(
    id: string,
    preferences: {
      theme?: 'light' | 'dark' | 'system';
      language?: string;
      timezone?: string;
      notifications?: {
        email?: boolean;
        push?: boolean;
        marketing?: boolean;
      };
    }
  ): Promise<void> {
    await this.patch(
      `${API_ROUTES.USERS.UPDATE.replace(':id', id)}/preferences`,
      preferences
    );
  }
}
