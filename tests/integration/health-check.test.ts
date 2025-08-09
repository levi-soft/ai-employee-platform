
import request from 'supertest';
import express from 'express';
import { healthCheckRouter } from '../../packages/shared-utils/src/health-check';

describe('Health Check Integration', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/health', healthCheckRouter);
  });

  it('should return health status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('checks');
  });

  it('should include system information', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.checks).toHaveProperty('system');
    expect(response.body.checks.system).toHaveProperty('status', 'healthy');
  });
});
