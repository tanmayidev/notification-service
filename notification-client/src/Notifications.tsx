import React, { useEffect, useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";

const GET_NOTIFICATIONS = gql`
  query GetNotifications($userId: Int!) {
    getNotificationsForUser(userId: $userId) {
      id
      message
      state
      createdAt
    }
  }
`;

const UPDATE_NOTIFICATION = gql`
  mutation UpdateUserNotification($id: Int!, $state: NotificationState!) {
    updateUserNotification(id: $id, state: $state) {
      id
      state
    }
  }
`;

const CREATE_NOTIFICATION = gql`
  mutation CreateNotification($message: String!, $userId: Int!) {
    createNotification(message: $message, userId: $userId) {
      id
      message
      state
      userId
    }
  }
`;

export const Notifications: React.FC = () => {
  const userId = 1;
  const { loading, error, data, refetch } = useQuery(GET_NOTIFICATIONS, {
    variables: { userId },
  });

  const [updateNotification] = useMutation(UPDATE_NOTIFICATION);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const intervalId = setInterval(() => {
      refetch();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [refetch]);

  const [createNotification] = useMutation(CREATE_NOTIFICATION);

  const handlePostMessage = async () => {
    if (message.trim() === "") return;
    try {
      const response = await createNotification({
        variables: { message, userId },
      });
      console.log("Notification created:", response.data.createNotification);
      setMessage("");
      refetch();
    } catch (error) {
      console.error("Error creating notification:", error);
    }
  };

  const handleUpdateNotification = async (notificationId: string) => {
    console.log("Marking notification as viewed:", notificationId);
    await updateNotification({
      variables: { userNotificationId: notificationId, state: "VIEWED" },
    });
    refetch();
  };

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <h2>Notifications</h2>
      <ul>
        {data.getNotificationsForUser.map((notification: any) => (
          <li key={notification.id}>
            {notification.message} - Status: {notification.state}
            <button onClick={() => handleUpdateNotification(notification.id)}>
              Mark as Viewed
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Enter your message"
      />
      <button onClick={handlePostMessage}>Post Message</button>
    </div>
  );
};
