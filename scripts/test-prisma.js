const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
console.log('PrismaClient created OK');
p.$disconnect().then(() => console.log('Disconnected OK'));
