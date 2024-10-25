import React, { useState, useEffect, useCallback } from 'react';
import { ApolloClient, InMemoryCache, ApolloProvider, useQuery, useMutation, useSubscription, gql } from '@apollo/client';
import { WebSocketLink } from '@apollo/client/link/ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { split, HttpLink } from '@apollo/client/core';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import { debounce } from 'lodash';

// Configure WebSocket client with reconnection logic
const wsClient = new SubscriptionClient('ws://localhost:3000/graphql', {
  reconnect: true,
  reconnectionAttempts: 5,
  connectionParams: {
    // Add authentication here if needed
  },
  lazy: true, // Only connect when needed
});

const wsLink = new WebSocketLink(wsClient);

const httpLink = new HttpLink({
  uri: 'http://localhost:3000/graphql',
  // Add authentication headers here if needed
});

// Split links for subscription vs query/mutation
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

// Configure cache with pagination
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        getNotificationsForUser: {
          // Implement custom merge function for cursor-based pagination
          keyArgs: ['userId'],
          merge(existing = { edges: [], pageInfo: {} }, incoming) {
            return {
              ...incoming,
              edges: [...(existing.edges || []), ...incoming.edges],
              pageInfo: incoming.pageInfo
            };
          }
        }
      }
    }
  }
});

const client = new ApolloClient({
  link: splitLink,
  cache,
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    }
  }
});

const GET_NOTIFICATIONS = gql`
  query GetNotifications($userId: String!, $cursor: String, $limit: Int) {
    getNotificationsForUser(userId: $userId, cursor: $cursor, limit: $limit) {
      edges {
        node {
          id
          message
          state
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
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

const NotificationList = ({ userId, usePolling = false }) => {
  const [notifications, setNotifications] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;

  const { loading, error, data, fetchMore } = useQuery(GET_NOTIFICATIONS, {
    variables: { userId, limit: PAGE_SIZE },
    pollInterval: usePolling ? 30000 : 0, // Reduced polling frequency
  });

  // Optimized subscription handling
  useSubscription(NOTIFICATION_SUBSCRIPTION, {
    variables: { userId },
    skip: usePolling,
    onData: ({ data: subData }) => {
      if (subData?.notificationAdded) {
        setNotifications(prev => {
          const newNotification = subData.notificationAdded;
          // Avoid duplicates
          if (prev.some(n => n.id === newNotification.id)) {
            return prev;
          }
          return [newNotification, ...prev].slice(0, 100); // Limit local cache
        });
      }
    }
  });

  // Debounced load more function
  const loadMore = useCallback(
    debounce(async () => {
      if (loadingMore || !data?.getNotificationsForUser.pageInfo.hasNextPage) return;

      setLoadingMore(true);
      try {
        await fetchMore({
          variables: {
            cursor: data.getNotificationsForUser.pageInfo.endCursor,
            limit: PAGE_SIZE
          }
        });
      } finally {
        setLoadingMore(false);
      }
    }, 250),
    [data, loadingMore, fetchMore]
  );

  // Infinite scroll handler
  const handleScroll = useCallback((event) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 300) { // 300px threshold
      loadMore();
    }
  }, [loadMore]);

  // Virtual list renderer
  const renderNotification = useCallback(({ item: notification }) => (
    <div key={notification.id} className="p-4 border-b">
      <p className="text-sm">{notification.message}</p>
      <p className="text-xs text-gray-500">
        {new Date(notification.createdAt).toLocaleString()}
      </p>
    </div>
  ), []);

  if (error) return <div>Error: {error.message}</div>;

  return (
    <div 
      className="h-screen overflow-auto"
      onScroll={handleScroll}
    >
      {loading && !data ? (
        <div>Loading...</div>
      ) : (
        <>
          {data?.getNotificationsForUser.edges.map(({ node }) => (
            renderNotification({ item: node })
          ))}
          {loadingMore && <div>Loading more...</div>}
        </>
      )}
    </div>
  );
};

export default function App() {
  return (