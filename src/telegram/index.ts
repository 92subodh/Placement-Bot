import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../database';
import { logger } from '../utils/logger';

const token = process.env.BOT_TOKEN;

// Only initialize if token is provided
export const bot = token ? new TelegramBot(token, { polling: true }) : null;

if (!bot) {
  logger.warn('BOT_TOKEN is not defined in environment variables. Telegram bot is disabled.');
} else {
  logger.info('Telegram bot initialized and polling started.');

  // Helper to get or create user
  const getOrCreateUser = async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id.toString();
    const user = await prisma.user.findUnique({ where: { telegramId: chatId } });
    
    if (user) return user;

    return await prisma.user.create({
      data: {
        telegramId: chatId,
        firstName: msg.from?.first_name || 'User',
        username: msg.from?.username,
        // Assume first user is admin for convenience, or they can set it via DB manually later
      }
    });
  };

  // /start command
  bot.onText(/^\/start$/, async (msg) => {
    try {
      await getOrCreateUser(msg);
      const welcomeMessage = `Welcome to the Placement Notification Bot! 🎓\n\nI will monitor the placement portal and notify you of new updates.\n\nUse /help to see available commands.`;
      bot.sendMessage(msg.chat.id, welcomeMessage);
    } catch (error) {
      logger.error('Error in /start:', error);
    }
  });

  // /help command
  bot.onText(/^\/help$/, (msg) => {
    const helpMessage = `
*Available Commands:*
/start - Register and start receiving notifications
/help - Show this message
/subscribe <keyword> - Add a filter keyword (e.g., /subscribe Amazon)
/unsubscribe <keyword> - Remove a filter keyword
/subscriptions - List your active subscriptions
/latest - Fetch the 5 most recent posts
/status - Check bot status
    `;
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  });

  // /subscribe <keyword>
  bot.onText(/^\/subscribe (.+)/, async (msg, match) => {
    try {
      const user = await getOrCreateUser(msg);
      const keyword = match ? match[1].trim() : '';

      if (!keyword) {
        return bot.sendMessage(msg.chat.id, 'Please provide a keyword. Example: /subscribe Amazon');
      }

      // Check if already subscribed
      const existing = await prisma.subscription.findFirst({
        where: { userId: user.id, keyword: { equals: keyword } } // Note: SQLite is generally case-insensitive in LIKE, but we might just store as is
      });

      if (existing) {
        return bot.sendMessage(msg.chat.id, `You are already subscribed to: *${keyword}*`, { parse_mode: 'Markdown' });
      }

      await prisma.subscription.create({
        data: { userId: user.id, keyword }
      });

      bot.sendMessage(msg.chat.id, `✅ Subscribed to: *${keyword}*`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /subscribe:', error);
    }
  });

  // /unsubscribe <keyword>
  bot.onText(/^\/unsubscribe (.+)/, async (msg, match) => {
    try {
      const user = await getOrCreateUser(msg);
      const keyword = match ? match[1].trim() : '';

      const deleted = await prisma.subscription.deleteMany({
        where: { userId: user.id, keyword }
      });

      if (deleted.count > 0) {
        bot.sendMessage(msg.chat.id, `❌ Unsubscribed from: *${keyword}*`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(msg.chat.id, `You were not subscribed to: *${keyword}*`, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      logger.error('Error in /unsubscribe:', error);
    }
  });

  // /subscriptions
  bot.onText(/^\/subscriptions$/, async (msg) => {
    try {
      const user = await getOrCreateUser(msg);
      const subs = await prisma.subscription.findMany({ where: { userId: user.id } });

      if (subs.length === 0) {
        return bot.sendMessage(msg.chat.id, 'You have no active subscriptions. You will receive all updates.');
      }

      const list = subs.map(s => `- ${s.keyword}`).join('\n');
      bot.sendMessage(msg.chat.id, `*Your Subscriptions:*\n${list}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /subscriptions:', error);
    }
  });

  // /status
  bot.onText(/^\/status$/, async (msg) => {
    try {
      const usersCount = await prisma.user.count();
      const postsCount = await prisma.post.count();
      bot.sendMessage(msg.chat.id, `🤖 *Bot Status*\n\nActive Users: ${usersCount}\nProcessed Posts: ${postsCount}\nPolling is Active.`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /status:', error);
    }
  });

  // /latest
  bot.onText(/^\/latest$/, async (msg) => {
    try {
      const posts = await prisma.post.findMany({
        orderBy: { portalCreatedAt: 'desc' },
        take: 5
      });

      if (posts.length === 0) {
        return bot.sendMessage(msg.chat.id, 'No posts have been processed yet.');
      }

      let reply = '*Latest 5 Posts:*\n\n';
      posts.forEach(p => {
        reply += `🏢 *${p.title}*\n📅 ${p.portalCreatedAt.toISOString().split('T')[0]}\n\n`;
      });

      bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /latest:', error);
    }
  });

  // Admin command: /setsession
  bot.onText(/^\/setsession (.+)/, async (msg, match) => {
    try {
      const user = await getOrCreateUser(msg);
      if (!user.isAdmin) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized.');
      }

      const sessionToken = match ? match[1].trim() : '';
      if (!sessionToken) return bot.sendMessage(msg.chat.id, 'Please provide the token.');

      await prisma.config.upsert({
        where: { key: 'SESSION_COOKIE' },
        update: { value: sessionToken },
        create: { key: 'SESSION_COOKIE', value: sessionToken }
      });

      bot.sendMessage(msg.chat.id, '✅ Session cookie updated successfully!');
    } catch (error) {
      logger.error('Error in /setsession:', error);
    }
  });
}
