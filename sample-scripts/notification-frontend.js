// App.jsx
import React, { useState, useEffect } from 'react';
import { ApolloClient, InMemoryCache, ApolloProvider, useQuery, useMutation, useSubscription, gql, split, HttpLink } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

// GraphQL queries
const GET_NOTIFICATIONS = gql`
  query GetNotifications($userId: String!) {
    getNotificationsForUser(userId: $userId) {
      id
      message
      state
      createdAt
    }
  }
`;

const UPDATE_NOTIFICATION = gql`
  mutation UpdateNotification($id: ID!, $state: NotificationState!) {
    updateUserNotification(id: $id, state: $state) {
      id
      state
    }
  }
`;

const NOTIFICATION_SUBSCRIPTION = gql`
  subscription OnNotificationAdded($userId: String!) {
    notificationAdded(userId: $userId) {
      id
      message
      state
      createdAt
    }
  }
`;

// Create Apollo Client with WebSocket support
const httpLink = new HttpLink({
  uri: 'http://localhost:3000/graphql'
});

const wsLink = new GraphQLWsLink(createClient({
  url: 'ws://localhost:3000/graphql',
}));

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    );
  },
  wsLink,
  httpLink
);

const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache()
});

const NotificationList = ({ userId, usePolling }) => {
  const [notifications, setNotifications] = useState([]);
  
  const { loading, error, data, refetch } = useQuery(GET_NOTIFICATIONS, {
    variables: { userId },
    pollInterval: usePolling ? 5000 : 0
  });

  const [updateNotification] = useMutation(UPDATE_NOTIFICATION);

  useSubscription(NOTIFICATION_SUBSCRIPTION, {
    variables: { userId },
    skip: usePolling,
    onData: ({ data }) => {
      if (data?.data?.notificationAdded) {
        setNotifications(prev => [...prev, data.data.notificationAdded]);
      }
    }
  });

  useEffect(() => {
    if (data?.getNotificationsForUser) {
      setNotifications(data.getNotificationsForUser);
    }
  }, [data]);

  const handleDismiss = async (id) => {
    await updateNotification({
      variables: { id, state: 'DISMISSED' }
    });
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">
        Notifications ({usePolling ? 'Polling' : 'Subscription'})
      </h2>
      {notifications.map(notification => (
        <div key={notification.id} className="p-4 border rounded shadow">
          <p>{notification.message}</p>
          <p className="text-sm text-gray-500">
            {new Date(notification.createdAt).toLocaleString()}
          </p>
          <button
            onClick={() => handleDismiss(notification.id)}
            className="mt-2 px-3 py-1 bg-red-500 text-white rounded"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
};

const App = () => {
  const userId = "user123"; // In real app, get from auth
  const [mode, setMode] = useState('polling');

  return (
    <ApolloProvider client={client}>
      <div className="container mx-auto p-4">
        <div className="mb-4">
          <button
            onClick={() => setMode(mode === 'polling' ? 'subscription' : 'polling')}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            Switch to {mode === 'polling' ? 'Subscription' : 'Polling'}
          </button>
        </div>
        <NotificationList
          userId={userId}
          usePolling={mode === 'polling'}
        />
      </div>
    </ApolloProvider>
  );
};

export default App;
