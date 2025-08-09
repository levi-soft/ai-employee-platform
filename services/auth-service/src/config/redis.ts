

import Redis from 'redis';

let redis: ReturnType<typeof Redis.createClient>;

export function createRedisClient() {
  if (!redis) {
    redis = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redis.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis Client Connected');
    });
  }

  return redis;
}

export async function connectRedis() {
  const client = createRedisClient();
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export { redis };

