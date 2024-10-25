import Fastify from "fastify";
import { ApolloServer } from "apollo-server-fastify";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { PrismaClient } from "@prisma/client";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers";

const fastify = Fastify();
const prisma = new PrismaClient();

const server = new ApolloServer({
  schema: makeExecutableSchema({
    typeDefs,
    resolvers,
  }),
});

const startServer = async () => {
  await server.start();

  // Use fastify.register() instead of .use()
  await fastify.register(
    await server.createHandler({
      path: "/graphql", // Specify the endpoint path
    })
  );

  try {
    await fastify.listen({ port: 4000 });
    console.log(`Server is running at http://localhost:4000/graphql`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

startServer().catch(console.error);
