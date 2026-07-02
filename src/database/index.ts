import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
  ],
});

prisma.$on('query', (e) => {
  // Uncomment the next line to log queries in development
  // logger.debug('Query: ' + e.query);
});
