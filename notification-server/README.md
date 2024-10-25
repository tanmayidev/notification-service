# Example Notification Service

### Prisma Setup

```
npx prisma init
npx prisma migrate dev --name init
npx prisma generate
```

### Running Server

```
npm run build
npm run dev
```

### Running Client

```
npm run start
```

### Todo :

- [ ] Fix the udpate notification status api
- [ ] Swap sqlite to postgresdb
- [ ] Implement Graphql subscription
- [ ] Implement Graphql polling
- [ ] Write load and scalability tests
