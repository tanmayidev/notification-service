import { gql } from "apollo-server-core";

export const typeDefs = gql`
  enum NotificationState {
    UNREAD
    VIEWED
    DISMISSED
    AUTODISMISSED
  }

  type Notification {
    id: Int!
    userId: Int!
    message: String!
    state: NotificationState!
    createdAt: String!
  }

  type Query {
    getNotificationsForUser(userId: Int!): [Notification!]!
  }

  type Mutation {
    createNotification(message: String!, userId: Int!): Notification!
    updateUserNotification(id: Int!, state: NotificationState!): Notification!
  }
`;
