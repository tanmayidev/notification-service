import { ApolloProvider } from "@apollo/client";
import React from "react";
import client from "./apolloClient";
import { Notifications } from "./Notifications";

const App: React.FC = () => {
  return (
    <ApolloProvider client={client}>
      <Notifications />
    </ApolloProvider>
  );
};

export default App;
