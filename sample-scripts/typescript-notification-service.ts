// types.ts
export enum NotificationState {
  UNREAD = 'UNREAD',
  READ = 'READ',
  DISMISSED = 'DISMISSED'
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  state: NotificationState;
  createdAt: Date;
}

export interface NotificationInput {
  userId: string;
  message: string;
}

export interface UpdateNotificationInput {
  id: string;
  state: NotificationState;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string;
}

export interface NotificationEdge {
  node: Notification;
  cursor: string;
}

export interface NotificationConnection {
  edges: NotificationEdge[];
  pageInfo: PageInfo;
}

export interface NotificationQueryArgs {
  userId: string;
  cursor?: string;
  limit?: number;
}

// database.ts
import { Pool, PoolConfig } from 'pg';
import { Redis } from 'ioredis';
import { Notification, NotificationState } from './types';

export class Database {
  private pool: Pool;
  private redis: Redis;

  constructor(pgConfig: PoolConfig, redisUrl: string) {
    this.pool = new Pool(pgConfig);
    this.redis = new Redis(redisUrl);
  }

  async initialize(): Promise<void> {
    const schema = `
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        state VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT state_check CHECK (state IN ('UNREAD', 'READ', 'DISMISSED'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_state ON notifications(user_id, state);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
    `;

    await this.pool.query(schema);
  }

  async getNotificationsForUser(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<Notification[]> {
    const cacheKey = `notifications:${userId}:${cursor || 'latest'}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const cursorClause = cursor ? 'AND created_at < $3' : '';
    const query = `
      SELECT * FROM notifications 
      WHERE user_id = $1 
      AND state != $2
      ${cursorClause}
      ORDER BY created_at DESC
      LIMIT $4
    `;

    const params = cursor 
      ? [userId, NotificationState.DISMISSED, new Date(cursor), limit]
      : [userId, NotificationState.DISMISSED, limit];

    const { rows } = await this.pool.query(query, params);

    const notifications = rows.map(this.mapNotification);
    await this.redis.set(cacheKey, JSON.stringify(notifications), 'EX', 300);

    return notifications;
  }

  async createNotification(
    userId: string,
    message: string
  ): Promise<Notification> {
    const { rows } = await this.pool.query(
      'INSERT INTO notifications (user_id, message, state) VALUES ($1, $2, $3) RETURNING *',
      [userId, message, NotificationState.UNREAD]
    );

    await this.invalidateCache(userId);
    return this.mapNotification(rows[0]);
  }

  async updateNotification(
    id: string,
    state: NotificationState
  ): Promise<Notification> {
    const { rows } = await this.pool.query(
      'UPDATE notifications SET state = $1 WHERE id = $2 RETURNING *',
      [state, id]
    );

    if (rows.length === 0) {
      throw new Error('Notification not found');
    }

    await this.invalidateCache(rows[0].user_id);
    return this.mapNotification(rows[0]);
  }

  async cleanupOldNotifications(daysOld: number, batchSize: number): Promise<number> {
    const date = new Date();
    date.setDate(date.getDate() - daysOld);

    const { rowCount } = await this.pool.query(
      'DELETE FROM notifications WHERE created_at < $1 LIMIT $2',
      [date, batchSize]
    );

    return rowCount || 0;
  }

  private async invalidateCache(userId: string): Promise<void> {
    const cachePattern = `notifications:${userId}:*`;
    const keys = await this.redis.keys(cachePattern);
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }

  private mapNotification(row: any): Notification {
    return {
      id: row.id.toString(),
      userId: row.user_id,
      message: row.message,
      state: row.state as NotificationState,
      createdAt: row.created_at
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.redis.quit();
  }
}

// schema.ts
import { makeExecutableSchema } from '@graphql-tools/schema';
import { DateTimeResolver } from 'graphql-scalars';

export const typeDefs = `
  scalar DateTime

  type Notification {
    id: ID!
    userId: String!
    message: String!
    state: NotificationState!
    createdAt: DateTime!
  }

  enum NotificationState {
    UNREAD
    READ
    DISMISSED
  }

  type NotificationEdge {
    node: Notification!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type NotificationConnection {
    edges: [NotificationEdge!]!
    pageInfo: PageInfo!
  }

  type Query {
    getNotificationsForUser(userId: String!, cursor: String, limit: Int): NotificationConnection!
  }

  type Mutation {
    createNotification(userId: String!, message: String!): Notification!
    updateNotification(id: ID!, state: NotificationState!): Notification!
  }

  type Subscription {
    notificationAdded(userId: String!): Notification!
  }
`;

// resolvers.ts
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { Database } from './database';
import { 
  Notification, 
  NotificationConnection,
  NotificationQueryArgs,
  NotificationState 
} from './types';

export const createResolvers = (db: Database, pubsub: RedisPubSub) => ({
  Query: {
    getNotificationsForUser: async (
      _: unknown,
      { userId, cursor, limit }: NotificationQueryArgs
    ): Promise<NotificationConnection> => {
      const notifications = await db.getNotificationsForUser(userId, cursor, limit);
      const hasNextPage = notifications.length > limit!;
      const edges = notifications.slice(0, limit).map(notification => ({
        node: notification,
        cursor: notification.createdAt.toISOString()
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
        }
      };
    }
  },

  Mutation: {
    createNotification: async (
      _: unknown,
      { userId, message }: { userId: string; message: string }
    ): Promise<Notification> => {
      const notification = await db.createNotification(userId, message);
      
      pubsub.publish(`NOTIFICATION_ADDED:${userId}`, {
        notificationAdded: notification
      });

      return notification;
    },

    updateNotification: async (
      _: unknown,
      { id, state }: { id: string; state: NotificationState }
    ): Promise<Notification> => {
      return await db.updateNotification(id, state);
    }
  },

  Subscription: {
    notificationAdded: {
      subscribe: (_: unknown, { userId }: { userId: string }) => 
        pubsub.asyncIterator(`NOTIFICATION_ADDED:${userId}`)
    }
  }
});

// server.ts
import fastify, { FastifyInstance } from 'fastify';
import { mercurius } from 'mercurius';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { Database } from './database';
import { typeDefs } from './schema';
import { createResolvers } from './resolvers';
import { CleanupJob } from './cleanup';

interface ServerConfig {
  port: number;
  host: string;
  postgresql: {
    user: string;
    password: string;
    host: string;
    database: string;
    port: number;
  };
  redis: {
    host: string;
    port: number;
  };
}

export class NotificationServer {
  private app: FastifyInstance;
  private db: Database;
  private pubsub: RedisPubSub;
  private cleanup: CleanupJob;

  constructor(private config: ServerConfig) {
    this.app = fastify({ logger: true });
    this.db = new Database(config.postgresql, `redis://${config.redis.host}:${config.redis.port}`);
    this.pubsub = new RedisPubSub({
      connection: {
        host: config.redis.host,
        port: config.redis.port
      }
    });
    this.cleanup = new CleanupJob(this.db);
  }

  async initialize(): Promise<void> {
    await this.db.initialize();
    
    // Register rate limiting
    await this.app.register(import('@fastify/rate-limit'), {
      max: 100,
      timeWindow: '1 minute'
    });

    // Register GraphQL
    await this.app.register(mercurius, {
      schema: typeDefs,
      resolvers: createResolvers(this.db, this.pubsub),
      subscription: true,
      graphiql: true
    });

    // Start cleanup job
    this.cleanup.start();
  }

  async start(): Promise<void> {
    try {
      await this.app.listen({
        port: this.config.port,
        host: this.config.host
      });
    } catch (err) {
      this.app.log.error(err);
      process.exit(1);
    }
  }

  async close(): Promise<void> {
    this.cleanup.stop();
    await this.db.close();
    await this.pubsub.close();
    await this.app.close();
  }
}

// cleanup.ts
import { Database } from './database';

export class CleanupJob {
  private timer?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 1000;
  private readonly RETENTION_DAYS = 7;
  private readonly INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private db: Database) {}

  start(): void {
    this.timer = setInterval(
      () => this.cleanup(),
      this.INTERVAL
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async cleanup(): Promise<void> {
    let totalDeleted = 0;
    let deleted: number;

    do {
      deleted = await this.db.cleanupOldNotifications(
        this.RETENTION_DAYS,
        this.BATCH_SIZE
      );
      totalDeleted += deleted;

      if (deleted === this.BATCH_SIZE) {
        // Add small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } while (deleted === this.BATCH_SIZE);

    console.log(`Cleaned up ${totalDeleted} old notifications`);
  }
}

// index.ts
import { NotificationServer } from './server';
import * as cluster from 'cluster';
import { cpus } from 'os';

const config = {
  port: 3000,
  host: '0.0.0.0',
  postgresql: {
    user: 'postgres',
    password: 'yourpassword',
    host: 'localhost',
    database: 'notifications',
    port: 5432
  },
  redis: {
    host: 'localhost',
    port: 6379
  }
};

async function main() {
  if (cluster.isPrimary) {
    const numCPUs = cpus().length;
    
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died`);
      cluster.fork();
    });
  } else {
    const server = new NotificationServer(config);
    
    await server.initialize();
    await server.start();

    process.on('SIGTERM', async () => {
      await server.close();
      process.exit(0);
    });
  }
}

main().catch(console.error);
