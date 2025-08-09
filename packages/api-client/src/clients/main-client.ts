
// Main API client that combines all specialized clients
import { BaseAPIClient } from './base-client';
import { AuthClient } from './auth-client';
import { AIClient } from './ai-client';
import { UserClient } from './user-client';
import { BillingClient } from './billing-client';
import { PluginClient } from './plugin-client';
import type { APIClientConfig, AuthTokens } from '../types';

export class AIEmployeePlatformClient extends BaseAPIClient {
  public auth: AuthClient;
  public ai: AIClient;
  public users: UserClient;
  public billing: BillingClient;
  public plugins: PluginClient;

  constructor(config: APIClientConfig) {
    super(config);
    
    // Initialize specialized clients with the same configuration
    this.auth = new AuthClient(config);
    this.ai = new AIClient(config);
    this.users = new UserClient(config);
    this.billing = new BillingClient(config);
    this.plugins = new PluginClient(config);
    
    // Sync tokens across all clients
    this.syncTokensAcrossClients();
  }

  private syncTokensAcrossClients(): void {
    const syncTokens = (tokens: AuthTokens) => {
      this.auth.setTokens(tokens);
      this.ai.setTokens(tokens);
      this.users.setTokens(tokens);
      this.billing.setTokens(tokens);
      this.plugins.setTokens(tokens);
    };

    const clearTokens = () => {
      this.auth.clearTokens();
      this.ai.clearTokens();
      this.users.clearTokens();
      this.billing.clearTokens();
      this.plugins.clearTokens();
    };

    // Override setTokens to sync across all clients
    const originalSetTokens = this.setTokens.bind(this);
    this.setTokens = (tokens: AuthTokens) => {
      originalSetTokens(tokens);
      syncTokens(tokens);
    };

    // Override clearTokens to sync across all clients
    const originalClearTokens = this.clearTokens.bind(this);
    this.clearTokens = () => {
      originalClearTokens();
      clearTokens();
    };
  }

  // Authentication convenience methods
  async login(email: string, password: string, rememberMe = false) {
    const result = await this.auth.login({ email, password, rememberMe });
    return result;
  }

  async logout() {
    await this.auth.logout();
  }

  isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  // System health check
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'unhealthy';
      responseTime?: number;
    }>;
    timestamp: Date;
  }> {
    const services = [
      { name: 'auth', client: this.auth },
      { name: 'ai', client: this.ai },
      { name: 'users', client: this.users },
      { name: 'billing', client: this.billing },
      { name: 'plugins', client: this.plugins },
    ];

    const results = await Promise.allSettled(
      services.map(async (service) => {
        const startTime = Date.now();
        try {
          const isHealthy = await service.client.healthCheck();
          const responseTime = Date.now() - startTime;
          return {
            name: service.name,
            status: isHealthy ? 'healthy' as const : 'unhealthy' as const,
            responseTime,
          };
        } catch {
          return {
            name: service.name,
            status: 'unhealthy' as const,
            responseTime: Date.now() - startTime,
          };
        }
      })
    );

    const serviceResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: services[index].name,
          status: 'unhealthy' as const,
          responseTime: undefined,
        };
      }
    });

    const healthyCount = serviceResults.filter(s => s.status === 'healthy').length;
    const totalCount = serviceResults.length;
    
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (healthyCount === totalCount) {
      overallStatus = 'healthy';
    } else if (healthyCount >= totalCount / 2) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    return {
      status: overallStatus,
      services: serviceResults,
      timestamp: new Date(),
    };
  }

  // Configuration update that affects all clients
  public updateConfig(config: Partial<APIClientConfig>): void {
    super.updateConfig(config);
    this.auth.updateConfig(config);
    this.ai.updateConfig(config);
    this.users.updateConfig(config);
    this.billing.updateConfig(config);
    this.plugins.updateConfig(config);
  }

  // Batch operations across different services
  async getUserDashboardData(userId: string) {
    try {
      const [user, creditAccount, recentRequests, userPlugins] = await Promise.allSettled([
        this.users.getUser(userId),
        this.billing.getCreditAccount(userId),
        this.ai.getRequests({ userId, limit: 5 }),
        this.plugins.getUserPlugins(),
      ]);

      return {
        user: user.status === 'fulfilled' ? user.value : null,
        creditAccount: creditAccount.status === 'fulfilled' ? creditAccount.value : null,
        recentRequests: recentRequests.status === 'fulfilled' ? recentRequests.value : null,
        userPlugins: userPlugins.status === 'fulfilled' ? userPlugins.value : null,
        errors: [
          user.status === 'rejected' ? { service: 'users', error: user.reason } : null,
          creditAccount.status === 'rejected' ? { service: 'billing', error: creditAccount.reason } : null,
          recentRequests.status === 'rejected' ? { service: 'ai', error: recentRequests.reason } : null,
          userPlugins.status === 'rejected' ? { service: 'plugins', error: userPlugins.reason } : null,
        ].filter(Boolean),
      };
    } catch (error) {
      throw error;
    }
  }
}

// Factory function for creating the client
export function createAIEmployeePlatformClient(config: APIClientConfig): AIEmployeePlatformClient {
  return new AIEmployeePlatformClient(config);
}

// Export individual clients for tree-shaking
export {
  AuthClient,
  AIClient,
  UserClient,
  BillingClient,
  PluginClient,
} from './';
