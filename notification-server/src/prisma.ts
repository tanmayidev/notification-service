import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createNotification(userId: number, message: string) {
  try {
    // Create a new notification in the database
    const newNotification = await prisma.notification.create({
      data: {
        userId: userId,
        message: message,
        state: "UNREAD", // This is optional since it's the default value
      },
    });

    console.log("Notification created:", newNotification);
  } catch (error) {
    console.error("Error creating notification:", error);
  } finally {
    // Close the Prisma Client
    await prisma.$disconnect();
  }
}

// Example usage
createNotification(1, "Your notification message here");

export default prisma;
