import prisma from "./prisma";
import { NotificationState } from "./types";

export const resolvers = {
  Query: {
    getNotificationsForUser: async (_: any, args: { userId: number }) => {
      return prisma.notification.findMany({
        where: {
          userId: args.userId,
          state: {
            not: NotificationState.DISMISSED,
          },
        },
      });
    },
  },
  Mutation: {
    createNotification: async (
      _: any,
      args: { message: string; userId: number }
    ) => {
      const newNotification = await prisma.notification.create({
        data: {
          message: args.message,
          state: NotificationState.UNREAD,
          userId: args.userId,
        },
      });

      return newNotification;
    },
    updateUserNotification: async (
      _: any,
      args: { id: number; state: NotificationState }
    ) => {
      if (!Object.values(NotificationState).includes(args.state)) {
        throw new Error("Invalid notification state");
      }

      return prisma.notification.update({
        where: { id: args.id },
        data: { state: args.state },
      });
    },
  },
};
