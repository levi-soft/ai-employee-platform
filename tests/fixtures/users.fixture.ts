
import { User, Role } from '@ai-platform/shared-types';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  isActive: boolean;
}

export const testUsers: TestUser[] = [
  {
    id: 'test-admin-1',
    email: 'admin@test.com',
    name: 'Test Admin',
    password: 'AdminPass123!',
    role: 'ADMIN',
    isActive: true,
  },
  {
    id: 'test-employee-1',
    email: 'employee1@test.com',
    name: 'Test Employee 1',
    password: 'EmpPass123!',
    role: 'EMPLOYEE',
    isActive: true,
  },
  {
    id: 'test-employee-2',
    email: 'employee2@test.com',
    name: 'Test Employee 2',
    password: 'EmpPass123!',
    role: 'EMPLOYEE',
    isActive: true,
  },
  {
    id: 'test-inactive-user',
    email: 'inactive@test.com',
    name: 'Inactive User',
    password: 'InactivePass123!',
    role: 'EMPLOYEE',
    isActive: false,
  },
];

export const getTestUser = (role: Role = 'EMPLOYEE'): TestUser => {
  const user = testUsers.find(u => u.role === role && u.isActive);
  if (!user) {
    throw new Error(`No test user found with role: ${role}`);
  }
  return user;
};

export const getTestAdmin = (): TestUser => getTestUser('ADMIN');
export const getTestEmployee = (): TestUser => getTestUser('EMPLOYEE');

export const generateRandomUser = (overrides: Partial<TestUser> = {}): TestUser => ({
  id: `test-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  email: `test-${Date.now()}@example.com`,
  name: `Test User ${Date.now()}`,
  password: 'TestPassword123!',
  role: 'EMPLOYEE',
  isActive: true,
  ...overrides,
});
