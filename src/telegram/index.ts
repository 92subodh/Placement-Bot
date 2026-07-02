import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../database';
import { ApiService } from '../api/ApiService';
import { AttachmentService } from '../services/AttachmentService';
import { logger } from '../utils/logger';

const token = process.env.BOT_TOKEN;

// Only initialize if token is provided
export const bot = token ? new TelegramBot(token, { polling: true }) : null;

if (!bot) {
  logger.warn('BOT_TOKEN is not defined in environment variables. Telegram bot is disabled.');
} else {
  logger.info('Telegram bot initialized and polling started.');

  // Set bot commands menu (appears as the "/" menu button in Telegram)
  bot.setMyCommands([
    { command: 'start', description: '🎓 Register and start receiving notifications' },
    { command: 'latest', description: '📋 View the 5 most recent placement posts' },
    { command: 'help', description: '❓ Show all available commands' },
  ]).then(() => logger.info('Bot command menu registered.'))
    .catch((e) => logger.error('Failed to set bot commands:', e));

  // ─── Helper: get or create user ──────────────────────────────────────────────
  const getOrCreateUser = async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id.toString();
    const user = await prisma.user.findUnique({ where: { telegramId: chatId } });
    if (user) return user;
    return await prisma.user.create({
      data: {
        telegramId: chatId,
        firstName: msg.from?.first_name || 'User',
        username: msg.from?.username,
      },
    });
  };

  // ─── Helper: format and send a full post (with attachments) ──────────────────
  const sendFullPost = async (chatId: string | number, postId: string) => {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { attachments: true },
    });

    if (!post) {
      await bot.sendMessage(chatId, '❌ Post not found.');
      return;
    }

    const contentLimit = 3500;
    const displayContent = post.content && post.content.length > contentLimit
      ? post.content.substring(0, contentLimit) + '...\n\n_[Message truncated due to length]_'
      : post.content || 'No details available.';

    const message =
      `📢 *Placement Update*\n\n` +
      `🏢 *Title*\n${post.title}\n\n` +
      `📅 *Posted*\n${post.portalCreatedAt.toISOString().split('T')[0]}\n\n` +
      `📝 *Details*\n${displayContent}\n\n` +
      `[🔗 View Original Post on Portal](https://www.aitplacements.in/)`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    // Send attachments if any
    if (post.attachments.length > 0) {
      await bot.sendMessage(chatId, `📎 *${post.attachments.length} Attachment(s):*`, { parse_mode: 'Markdown' });
      for (const att of post.attachments) {
        try {
          // Use saved local path if file still exists on disk
          let filePath = att.localFilePath && fs.existsSync(att.localFilePath) ? att.localFilePath : null;

          if (!filePath) {
            // File not on disk — re-download from portal
            logger.info(`Re-downloading missing attachment: ${att.originalFileName}`);
            filePath = await AttachmentService.getOrDownloadAttachment(att.portalAttachmentId, att.originalFileName);
          }

          if (filePath) {
            await bot.sendDocument(chatId, filePath, { caption: att.originalFileName });
          } else {
            await bot.sendMessage(chatId, `📎 Could not retrieve: ${att.originalFileName}`);
          }
        } catch (err: any) {
          logger.error(`Failed to send attachment ${att.originalFileName}:`, err.message);
          await bot.sendMessage(chatId, `📎 Could not send: ${att.originalFileName}`);
        }
      }
    }
  };

  // ─── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/^\/start$/, async (msg) => {
    try {
      await getOrCreateUser(msg);
      await bot.sendMessage(
        msg.chat.id,
        `👋 Welcome to the *Placement Notification Bot!* 🎓\n\n` +
        `I automatically monitor the AIT placement portal and notify you the moment a new update is posted.\n\n` +
        `Use the *menu button* (tap \`/\`) to see all available commands.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error in /start:', error);
    }
  });

  // ─── /help ───────────────────────────────────────────────────────────────────
  bot.onText(/^\/help$/, async (msg) => {
    const user = await getOrCreateUser(msg);
    const helpMessage =
      `*📖 Available Commands:*\n\n` +
      `/start — Register and start receiving notifications\n` +
      `/latest — View the 5 most recent placement posts\n` +
      `/help — Show this message\n` +
      (user.isAdmin ? `\n_Admin only:_\n/status — Check bot health and statistics\n/setsession \`<token>\` — Update the portal session cookie` : ``);
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  });

  // ─── /status ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/status$/, async (msg) => {
    try {
      const user = await getOrCreateUser(msg);
      if (!user.isAdmin) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized. Only admins can use this command.');
      }

      const usersCount = await prisma.user.count();
      const postsCount = await prisma.post.count();
      const notifCount = await prisma.notification.count({ where: { status: 'SENT' } });
      const hasCookie = !!(await prisma.config.findUnique({ where: { key: 'SESSION_COOKIE' } }));
      bot.sendMessage(
        msg.chat.id,
        `🤖 *Bot Status*\n\n` +
        `👥 Registered Users: ${usersCount}\n` +
        `📰 Processed Posts: ${postsCount}\n` +
        `📨 Notifications Sent: ${notifCount}\n` +
        `🔑 Portal Auth: ${hasCookie ? '✅ Active' : '❌ No session cookie set'}\n` +
        `⏱ Polling: Every 2 minutes`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error in /status:', error);
    }
  });

  // ─── /latest ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/latest$/, async (msg) => {
    try {
      const posts = await prisma.post.findMany({
        orderBy: [
          { portalCreatedAt: 'desc' },
          { createdAt: 'desc' } // Tie-breaker for posts with the same date
        ],
        take: 5,
      });

      if (posts.length === 0) {
        return bot.sendMessage(msg.chat.id, '📭 No posts have been processed yet.\n\nThe bot may still be fetching data. Try again in a couple of minutes.');
      }

      await bot.sendMessage(msg.chat.id, `📋 *Latest ${posts.length} Placement Posts:*\n\n_Tap a button below to read the full post and download attachments._`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: posts.map((p) => ([{
            text: `🏢 ${p.title.length > 50 ? p.title.substring(0, 50) + '...' : p.title}`,
            callback_data: `post:${p.id}`,
          }])),
        },
      });
    } catch (error) {
      logger.error('Error in /latest:', error);
    }
  });

  // ─── Inline button callback handler ──────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) return;

    // Acknowledge the button press immediately (removes the loading spinner)
    await bot.answerCallbackQuery(query.id, { text: '⏳ Fetching post...' });

    if (data.startsWith('post:')) {
      const postId = data.replace('post:', '');
      try {
        await sendFullPost(chatId, postId);
      } catch (error: any) {
        logger.error('Error handling post callback:', error.message);
        await bot.sendMessage(chatId, '❌ Failed to fetch post details. Please try again.');
      }
    }
  });

  // ─── Admin: /setsession ───────────────────────────────────────────────────────
  bot.onText(/^\/setsession (.+)/, async (msg, match) => {
    try {
      const user = await getOrCreateUser(msg);
      if (!user.isAdmin) {
        return bot.sendMessage(msg.chat.id, '🚫 Unauthorized. Only admins can use this command.');
      }

      const sessionToken = match ? match[1].trim() : '';
      if (!sessionToken) return bot.sendMessage(msg.chat.id, 'Please provide the session token.');

      await prisma.config.upsert({
        where: { key: 'SESSION_COOKIE' },
        update: { value: sessionToken },
        create: { key: 'SESSION_COOKIE', value: sessionToken },
      });

      bot.sendMessage(msg.chat.id, '✅ Session cookie updated successfully! The bot will use it on the next polling cycle.');
    } catch (error) {
      logger.error('Error in /setsession:', error);
    }
  });
}
