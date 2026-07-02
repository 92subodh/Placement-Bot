import 'dotenv/config';
import { logger } from './utils/logger';
import './telegram'; // Initialize telegram bot
import { startScheduler } from './scheduler';

logger.info('Starting Placement Notification Bot...');

startScheduler();

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
