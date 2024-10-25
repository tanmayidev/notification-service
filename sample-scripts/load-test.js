// loadTest.js
const autocannon = require('autocannon');

const pollingTest = async () => {
  const result = await autocannon({
    url: 'http://localhost:3000/graphql',
    connections: 100,
    duration: 30,
    requests: [{
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          query {
            getNotificationsForUser(userId: "user123") {
              id
              message
              state
            }
          }
        `
      })
    }]
  });

  console.log(result);
};

const wsTest = async () => {
  const WebSocket = require('ws');
  const clients = [];
  
  // Create 100 WebSocket connections
  for (let i = 0; i < 100; i++) {
    const ws = new WebSocket('ws://localhost:3000/graphql');
    clients.push(ws);
    
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        payload: {
          query: `
            subscription {
              notificationAdded(userId: "user123") {
                id
                message
              }
            }
          `
        }
      }));
    });
  }

  // Run for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Cleanup
  clients.forEach(ws => ws.close());
  console.log('WebSocket test complete');
};

// Run both tests
async function runTests() {
  console.log('Running polling test...');
  await pollingTest();
  
  console.log('Running WebSocket test...');
  await wsTest();
}

runTests();
