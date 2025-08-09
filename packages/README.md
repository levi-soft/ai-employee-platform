# Shared Packages

This directory contains shared packages used across the AI Employee Platform monorepo.

## Packages

### @ai-platform/shared-types

TypeScript type definitions shared across all applications and services.

**Features:**

- API types and interfaces
- Authentication types
- Database model types
- Common utility types
- Complete type coverage for all endpoints

**Usage:**

```typescript
import { User, AIRequest, APIResponse } from '@ai-platform/shared-types'
```

### @ai-platform/shared-utils

Common utility functions for validation, encryption, formatting, and constants.

**Features:**

- Input validation with Zod schemas
- Password hashing and encryption utilities
- Date/time and number formatting
- Platform constants and configuration
- Error handling utilities

**Usage:**

```typescript
import { validateEmail, formatCurrency, hashPassword } from '@ai-platform/shared-utils'
```

### @ai-platform/api-client

HTTP client with interceptors, authentication, and error handling.

**Features:**

- Axios-based HTTP client with interceptors
- Automatic token refresh
- Request/response logging
- Error handling and retry logic
- Specialized clients for each service

**Usage:**

```typescript
import { createAIEmployeePlatformClient } from '@ai-platform/api-client'

const client = createAIEmployeePlatformClient({
  baseURL: 'https://api.example.com',
})

// Use specialized clients
const user = await client.users.getUser('123')
const aiResponse = await client.ai.generateText('Hello world')
```

### @ai-platform/ui-components

Reusable React components built with Tailwind CSS and Radix UI.

**Features:**

- Pre-built UI components (Button, Input, Card, etc.)
- Form components with validation
- Loading states and feedback components
- Custom hooks for common patterns
- Consistent design system

**Usage:**

```tsx
import { Button, FormField, LoadingSpinner } from '@ai-platform/ui-components'

function LoginForm() {
  return (
    <form>
      <FormField label='Email' type='email' required />
      <Button loading={isLoading}>Sign In</Button>
    </form>
  )
}
```

## Development

### Building Packages

```bash
# Build all packages
turbo run build

# Build specific package
turbo run build --filter=@ai-platform/shared-types
```

### Type Checking

```bash
# Type check all packages
turbo run type-check

# Type check specific package
cd packages/shared-types && npm run typecheck
```

### Testing

```bash
# Test all packages
turbo run test

# Test specific package
cd packages/api-client && npm test
```

## Integration Examples

### Full Stack Integration

```typescript
// In a Next.js app
import { createAIEmployeePlatformClient } from '@ai-platform/api-client';
import { Button, Card } from '@ai-platform/ui-components';
import { formatCurrency } from '@ai-platform/shared-utils';
import type { User } from '@ai-platform/shared-types';

const client = createAIEmployeePlatformClient({
  baseURL: process.env.API_BASE_URL,
});

export default function UserDashboard() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    client.auth.getProfile().then(setUser);
  }, []);

  if (!user) return <LoadingSpinner />;

  return (
    <Card>
      <h1>Welcome, {user.firstName}!</h1>
      <p>Credits: {formatCurrency(user.creditAccount?.balance || 0)}</p>
      <Button onClick={() => client.auth.logout()}>
        Logout
      </Button>
    </Card>
  );
}
```

### Service Integration

```typescript
// In a microservice
import { validateEmail, hashPassword } from '@ai-platform/shared-utils'
import type { User, LoginRequest } from '@ai-platform/shared-types'

export async function createUser(data: LoginRequest): Promise<User> {
  // Validate input
  if (!validateEmail(data.email)) {
    throw new Error('Invalid email')
  }

  // Hash password
  const passwordHash = await hashPassword(data.password)

  // Create user...
  return newUser
}
```

## Contributing

When adding new functionality to shared packages:

1. **Types**: Add TypeScript definitions to `shared-types`
2. **Utils**: Add utility functions to `shared-utils`
3. **API**: Add API methods to `api-client`
4. **UI**: Add React components to `ui-components`

Ensure all packages are properly typed and tested before publishing.
