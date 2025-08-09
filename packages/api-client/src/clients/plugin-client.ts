
// Plugin management API client
import { BaseAPIClient } from './base-client';
import {
  Plugin,
  UserPlugin,
  PluginListParams,
  PaginatedResponse,
} from '@ai-platform/shared-types';
import { API_ROUTES } from '@ai-platform/shared-types';

export class PluginClient extends BaseAPIClient {
  // Plugin marketplace
  async getPlugins(params?: PluginListParams): Promise<PaginatedResponse<Plugin>> {
    return this.getPaginated<Plugin>(API_ROUTES.PLUGINS.LIST, params);
  }

  async getPlugin(id: string): Promise<Plugin> {
    const response = await this.get<Plugin>(
      API_ROUTES.PLUGINS.GET.replace(':id', id)
    );
    return response.data!;
  }

  async searchPlugins(query: string, filters?: {
    category?: string;
    tags?: string[];
    isOfficial?: boolean;
    minRating?: number;
  }): Promise<Plugin[]> {
    const response = await this.get<Plugin[]>('/plugins/search', {
      params: { query, ...filters },
    });
    return response.data!;
  }

  async getFeaturedPlugins(): Promise<Plugin[]> {
    const response = await this.get<Plugin[]>('/plugins/featured');
    return response.data!;
  }

  async getPluginsByCategory(category: string): Promise<Plugin[]> {
    const response = await this.get<Plugin[]>(`/plugins/category/${category}`);
    return response.data!;
  }

  // User plugin management
  async getUserPlugins(): Promise<UserPlugin[]> {
    const response = await this.get<UserPlugin[]>(API_ROUTES.PLUGINS.USER_PLUGINS);
    return response.data!;
  }

  async installPlugin(pluginId: string, configuration?: Record<string, any>): Promise<UserPlugin> {
    const response = await this.post<UserPlugin>(
      API_ROUTES.PLUGINS.INSTALL.replace(':id', pluginId),
      { configuration }
    );
    return response.data!;
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.post(API_ROUTES.PLUGINS.UNINSTALL.replace(':id', pluginId));
  }

  async enablePlugin(pluginId: string): Promise<UserPlugin> {
    const response = await this.post<UserPlugin>(`/plugins/${pluginId}/enable`);
    return response.data!;
  }

  async disablePlugin(pluginId: string): Promise<UserPlugin> {
    const response = await this.post<UserPlugin>(`/plugins/${pluginId}/disable`);
    return response.data!;
  }

  async updatePluginConfiguration(
    pluginId: string,
    configuration: Record<string, any>
  ): Promise<UserPlugin> {
    const response = await this.patch<UserPlugin>(`/plugins/${pluginId}/config`, {
      configuration,
    });
    return response.data!;
  }

  // Plugin development (for admin users)
  async createPlugin(pluginData: {
    name: string;
    description: string;
    version: string;
    category: string;
    tags: string[];
    codeBundle: File;
    manifest: Record<string, any>;
  }): Promise<Plugin> {
    const formData = new FormData();
    formData.append('name', pluginData.name);
    formData.append('description', pluginData.description);
    formData.append('version', pluginData.version);
    formData.append('category', pluginData.category);
    formData.append('tags', JSON.stringify(pluginData.tags));
    formData.append('codeBundle', pluginData.codeBundle);
    formData.append('manifest', JSON.stringify(pluginData.manifest));

    const response = await this.post<Plugin>('/plugins/create', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data!;
  }

  async updatePlugin(id: string, updates: Partial<Plugin>): Promise<Plugin> {
    const response = await this.patch<Plugin>(`/plugins/${id}`, updates);
    return response.data!;
  }

  async deletePlugin(id: string): Promise<void> {
    await this.delete(`/plugins/${id}`);
  }

  async publishPlugin(id: string): Promise<Plugin> {
    const response = await this.post<Plugin>(`/plugins/${id}/publish`);
    return response.data!;
  }

  async unpublishPlugin(id: string): Promise<Plugin> {
    const response = await this.post<Plugin>(`/plugins/${id}/unpublish`);
    return response.data!;
  }

  // Plugin execution
  async executePlugin(
    pluginId: string,
    input: any,
    context?: Record<string, any>
  ): Promise<{
    success: boolean;
    output: any;
    executionTime: number;
    logs?: string[];
    error?: string;
  }> {
    const response = await this.post<{
      success: boolean;
      output: any;
      executionTime: number;
      logs?: string[];
      error?: string;
    }>(`/plugins/${pluginId}/execute`, {
      input,
      context,
    });
    return response.data!;
  }

  // Plugin analytics
  async getPluginAnalytics(pluginId: string, timeRange: '7d' | '30d' | '90d' = '30d'): Promise<{
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    popularInputTypes: Array<{
      type: string;
      count: number;
    }>;
    executionTrend: Array<{
      date: string;
      executions: number;
      errors: number;
    }>;
  }> {
    const response = await this.get<{
      totalExecutions: number;
      successRate: number;
      averageExecutionTime: number;
      popularInputTypes: Array<{
        type: string;
        count: number;
      }>;
      executionTrend: Array<{
        date: string;
        executions: number;
        errors: number;
      }>;
    }>(`/plugins/${pluginId}/analytics`, {
      params: { timeRange },
    });
    
    return response.data!;
  }

  // Plugin reviews and ratings
  async ratePlugin(pluginId: string, rating: number, review?: string): Promise<void> {
    await this.post(`/plugins/${pluginId}/rate`, {
      rating,
      review,
    });
  }

  async getPluginReviews(pluginId: string, params?: {
    page?: number;
    limit?: number;
    rating?: number;
  }): Promise<PaginatedResponse<{
    id: string;
    userId: string;
    userName: string;
    rating: number;
    review?: string;
    createdAt: Date;
  }>> {
    const response = await this.getPaginated<{
      id: string;
      userId: string;
      userName: string;
      rating: number;
      review?: string;
      createdAt: string;
    }>(`/plugins/${pluginId}/reviews`, params);
    
    return {
      ...response,
      data: response.data.map(review => ({
        ...review,
        createdAt: new Date(review.createdAt),
      })),
    };
  }

  // Plugin permissions
  async getPluginPermissions(pluginId: string): Promise<{
    requiredPermissions: string[];
    grantedPermissions: string[];
    pendingPermissions: string[];
  }> {
    const response = await this.get<{
      requiredPermissions: string[];
      grantedPermissions: string[];
      pendingPermissions: string[];
    }>(`/plugins/${pluginId}/permissions`);
    
    return response.data!;
  }

  async grantPluginPermission(pluginId: string, permission: string): Promise<void> {
    await this.post(`/plugins/${pluginId}/permissions/grant`, {
      permission,
    });
  }

  async revokePluginPermission(pluginId: string, permission: string): Promise<void> {
    await this.post(`/plugins/${pluginId}/permissions/revoke`, {
      permission,
    });
  }
}
