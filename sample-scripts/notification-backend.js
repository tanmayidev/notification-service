// server.js
const fastify = require('fastify')({ logger: true });
const { mercurius } = require('mercurius');
const { PubSub } = require('graphql-subscriptions');
const pubsub = new PubSub();

// In-memory store for demo (replace with database in production)
const notifications = new Map();
const userNotifications = new Map();

const schema = `
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
    getNotificationsForUser(userId: String!): [Notification]!
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
    getNotificationsForUser: async (_, { userId }) => {
      const userNotes = Array.from(notifications.values())
        .filter(note => note.userId === userId && note.state !== 'DISMISSED');
      return userNotes;
    }
  },
  Mutation: {
    updateUserNotification: async (_, { id, state }) => {
      const notification = notifications.get(id);
      if (!notification) throw new Error('Notification not found');
      
      notification.state = state;
      notifications.set(id, notification);
      return notification;
    },
    createNotification: async (_, { userId, message }) => {
      const notification = {
        id: Date.now().toString(),
        userId,
        message,
        state: 'UNREAD',
        createdAt: new Date().toISOString()
      };
      
      notifications.set(notification.id, notification);
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
        return pubsub.asyncIterator('NOTIFICATION_ADDED');
      },
      resolve: (payload) => {
        return payload.notificationAdded;
      }
    }
  }
};

// Register GraphQL schema and resolvers
fastify.register(mercurius, {
  schema,
  resolvers,
  subscription: true,
  graphiql: true
});

// Cleanup job (runs every day)
setInterval(() => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  notifications.forEach((notification, id) => {
    if (new Date(notification.createdAt) < sevenDaysAgo) {
      notifications.delete(id);
    }
  });
}, 24 * 60 * 60 * 1000);

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
