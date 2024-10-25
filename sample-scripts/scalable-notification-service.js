// server.js
const fastify = require('fastify')({ logger: true });
const { mercurius } = require('mercurius');
const Redis = require('ioredis');
const { RedisPubSub } = require('graphql-redis-subscriptions');
const { Pool } = require('pg');

// PostgreSQL connection pool
const pgPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'notifications',
  password: 'yourpassword',
  port: 5432,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
});

// Redis for pub/sub and caching
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,
});

const pubsub = new RedisPubSub({
  publisher: new Redis(),
  subscriber: new Redis(),
});

// Cache configuration
const CACHE_TTL = 300; // 5 minutes
const BATCH_SIZE = 100;

// Database schema (run this in PostgreSQL)
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

// Initialize tables
pgPool.query(schema).catch(console.error);

const typeDefs = `
  type Notification {
    id: ID!
    userId: String!
    message: String!
    state: NotificationState!
    createdAt: String!
  }

  enum NotificationState {
    UNREAD
    READ
    DISMISSED
  }

  type Query {
    getNotificationsForUser(userId: String!, cursor: String, limit: Int): NotificationConnection!
  }

  type NotificationConnection {
    edges: [NotificationEdge!]!
    pageInfo: PageInfo!
  }

  type NotificationEdge {
    node: Notification!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Mutation {
    updateUserNotification(id: ID!, state: NotificationState!): Notification
    createNotification(userId: String!, message: String!): Notification
  }

  type Subscription {
    notificationAdded(userId: String!): Notification!
  }
`;

const resolvers = {
  Query: {
    getNotificationsForUser: async (_, { userId, cursor, limit = 20 }) => {
      // Try cache first
      const cacheKey = `notifications:${userId}:${cursor || 'latest'}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // If not in cache, query database with cursor-based pagination
      const cursorClause = cursor 
        ? 'AND created_at < $3'
        : '';
      
      const query = `
        SELECT * FROM notifications 
        WHERE user_id = $1 
        AND state != 'DISMISSED'
        ${cursorClause}
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const params = cursor 
        ? [userId, limit + 1, new Date(cursor)]
        : [userId, limit + 1];

      const { rows } = await pgPool.query(query, params);

      const hasNextPage = rows.length > limit;
      const edges = rows.slice(0, limit).map(row => ({
        node: {
          id: row.id,
          userId: row.user_id,
          message: row.message,
          state: row.state,
          createdAt: row.created_at.toISOString()
        },
        cursor: row.created_at.toISOString()
      }));

      const result = {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
        }
      };

      // Cache the result
      await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);

      return result;
    }
  },

  Mutation: {
    updateUserNotification: async (_, { id, state }) => {
      const { rows } = await pgPool.query(
        'UPDATE notifications SET state = $1 WHERE id = $2 RETURNING *',
        [state, id]
      );

      if (rows.length === 0) {
        throw new Error('Notification not found');
      }

      // Invalidate cache for this user
      const userId = rows[0].user_id;
      const cachePattern = `notifications:${userId}:*`;
      const keys = await redis.keys(cachePattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }

      return {
        id: rows[0].id,
        userId: rows[0].user_id,
        message: rows[0].message,
        state: rows[0].state,
        createdAt: rows[0].created_at.toISOString()
      };
    },

    createNotification: async (_, { userId, message }) => {
      const { rows } = await pgPool.query(
        'INSERT INTO notifications (user_id, message, state) VALUES ($1, $2, $3) RETURNING *',
        [userId, message, 'UNREAD']
      );

      const notification = {
        id: rows[0].id,
        userId: rows[0].user_id,
        message: rows[0].message,
        state: rows[0].state,
        createdAt: rows[0].created_at.toISOString()
      };

      // Invalidate cache
      const cachePattern = `notifications:${userId}:*`;
      const keys = await redis.keys(cachePattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }

      // Publish to Redis for subscriptions
      pubsub.publish('NOTIFICATION_ADDED', {
        notificationAdded: notification,
        userId
      });

      return notification;
    }
  },

  Subscription: {
    notificationAdded: {
      subscribe: async (_, { userId }) => {
        return pubsub.asyncIterator(`NOTIFICATION_ADDED:${userId}`);
      }
    }
  }
};

// Cleanup job using batch processing
async function cleanupOldNotifications() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let deleted = 0;
  while (true) {
    const { rowCount } = await pgPool.query(
      'DELETE FROM notifications WHERE created_at < $1 LIMIT $2',
      [sevenDaysAgo, BATCH_SIZE]
    );
    
    deleted += rowCount;
    if (rowCount < BATCH_SIZE) break;
    
    // Small delay between batches to reduce database load
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Cleaned up ${deleted} old notifications`);
}

// Run cleanup daily
setInterval(cleanupOldNotifications, 24 * 60 * 60 * 1000);

// Rate limiting middleware
fastify.register(require('@fastify/rate-limit'), {
  max: 100, // maximum 100 requests per windowMs
  timeWindow: '1 minute'
});

// Register GraphQL
fastify.register(mercurius, {
  schema: typeDefs,
  resolvers,
  subscription: true,
  graphiql: true
});

// Graceful shutdown
async function closeGracefully(signal) {
  console.log(`Received signal to terminate: ${signal}`);

  // Close fastify server
  await fastify.close();
  
  // Close database pool
  await pgPool.end();
  
  // Close Redis connections
  await redis.quit();
  await pubsub.close();
  
  process.exit(0);
}

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

// Start server with multiple workers
if (require('cluster').isPrimary) {
  const numCPUs = require('os').cpus().length;
  
  for (let i = 0; i < numCPUs; i++) {
    require('cluster').fork();
  }
} else {
  fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  });
}
