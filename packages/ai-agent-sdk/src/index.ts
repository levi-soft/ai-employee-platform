
// Core agent base classes and factories
export { AgentBase, AgentFactory, Agent } from './base/agent-base';

// Type definitions and interfaces
export * from './types/agent-types';

// Testing framework
export { AgentTester, TestBuilder } from './testing/agent-testing';

// Version
export const SDK_VERSION = '1.0.0';

// SDK utilities
export class AgentSDK {
  static version = SDK_VERSION;

  static createAgent(name: string, config: any) {
    return AgentFactory.create(name, config);
  }

  static registerAgent(name: string, agentClass: any) {
    return AgentFactory.register(name, agentClass);
  }

  static getRegisteredAgents() {
    return AgentFactory.getRegisteredAgents();
  }

  static createTester() {
    return new AgentTester();
  }

  static createTestBuilder() {
    return TestBuilder.create();
  }
}

// Default export
export default AgentSDK;
