import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
console.log('PrismaClient created OK');
await p.$disconnect();
console.log('Disconnected OK');
