import cron from 'node-cron';
import { ApiService } from '../api/ApiService';
import { AttachmentService } from '../services/AttachmentService';
import { FilterService } from '../services/FilterService';
import { HtmlParserService } from '../services/HtmlParserService';
import { prisma } from '../database';
import { bot } from '../telegram';
import { logger } from '../utils/logger';

// Helper: send message + attachments to a single chat
const sendPostToChat = async (chatId: string, message: string, filesToSend: { path: string; name: string }[]) => {
  await bot!.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  for (const file of filesToSend) {
    await bot!.sendDocument(chatId, file.path, { caption: file.name });
  }
};

export const startScheduler = () => {
  const checkInterval = process.env.CHECK_INTERVAL || '*/2 * * * *';

  cron.schedule(checkInterval, async () => {
    logger.info('Checking API for new posts...');
    try {
      const data = await ApiService.fetchPosts(10, 0);

      if (!data || !data.posts) {
        logger.error('Invalid response from /api/post/list');
        return;
      }

      logger.info(`Fetched ${data.posts.length} posts.`);
      const latestPosts = data.posts;

      for (const post of [...latestPosts].reverse()) {
        const exists = await prisma.post.findUnique({ where: { id: post.id } });

        if (!exists) {
          logger.info(`New post detected: "${post.title}"`);

          // Fetch full details
          const details = await ApiService.fetchPostDetails(post.id);
          const plainTextBody = HtmlParserService.parseHtml(details.body || '');

          // Save post to DB
          const savedPost = await prisma.post.create({
            data: {
              id: details.id,
              title: details.title,
              content: plainTextBody,
              author: details.userEmail || details.userId || 'Admin',
              portalCreatedAt: new Date(details.createdAt || post.createdAt),
            },
          });

          // Fetch & save attachment metadata
          const attachmentData = await ApiService.fetchAttachments(details.id);
          const filesToSend: { path: string; name: string }[] = [];

          if (attachmentData?.attachments?.length > 0) {
            logger.info(`Found ${attachmentData.attachments.length} attachment(s) for post "${savedPost.title}"`);
            for (const att of attachmentData.attachments) {
              // Download (or reuse if already on disk)
              const localPath = await AttachmentService.getOrDownloadAttachment(att.id, att.originalFileName);

              // Save metadata + local path to DB
              await prisma.attachment.create({
                data: {
                  portalAttachmentId: att.id,
                  postId: savedPost.id,
                  originalFileName: att.originalFileName,
                  s3Key: att.s3Key,
                  mimeType: att.fileType,
                  fileSize: att.fileSize,
                  status: att.status,
                  localFilePath: localPath,
                  createdAtPortal: new Date(att.createdAt || Date.now()),
                  updatedAtPortal: new Date(att.updatedAt || Date.now()),
                },
              });

              if (localPath) {
                filesToSend.push({ path: localPath, name: att.originalFileName });
              } else {
                logger.warn(`Failed to download attachment: ${att.originalFileName}`);
              }
            }
          } else {
            logger.info(`No attachments for post "${savedPost.title}"`);
          }

          const contentLimit = 3500;
          const displayContent = savedPost.content && savedPost.content.length > contentLimit
            ? savedPost.content.substring(0, contentLimit) + '...\n\n_[Message truncated due to length]_'
            : savedPost.content || 'See attachments.';

          const message =
            `📢 *New Placement Update*\n\n` +
            `🏢 *Title*\n${savedPost.title}\n\n` +
            `📅 *Posted*\n${savedPost.portalCreatedAt.toISOString().split('T')[0]}\n\n` +
            `📝 *Details*\n${displayContent}\n\n` +
            `👤 *Posted By*\n${savedPost.author}`;

          // Broadcast to channel first
          const channelId = process.env.CHANNEL_ID;
          if (bot && channelId) {
            try {
              await sendPostToChat(channelId, message, filesToSend);
              logger.info(`Broadcasted to channel ${channelId}`);
            } catch (error: any) {
              logger.error(`Failed to send to channel ${channelId}: ${error.message}`);
            }
          }

          // Send to matched users
          if (bot) {
            const matchedUsers = await FilterService.getMatchedUsersForPost(savedPost.title, savedPost.content);
            logger.info(`Sending to ${matchedUsers.length} matched user(s).`);

            for (const userId of matchedUsers) {
              const user = await prisma.user.findUnique({ where: { id: userId } });
              if (user?.telegramId) {
                try {
                  await sendPostToChat(user.telegramId, message, filesToSend);
                  await prisma.notification.create({
                    data: { postId: savedPost.id, userId: user.id, status: 'SENT' },
                  });
                  logger.info(`Sent to user ${user.telegramId}`);
                } catch (error: any) {
                  logger.error(`Failed to send to user ${user.telegramId}: ${error.message}`);
                  await prisma.notification.create({
                    data: { postId: savedPost.id, userId: user.id, status: 'FAILED' },
                  });
                }
              }
            }
          }

          logger.info(`Finished processing post "${savedPost.title}"`);
        }
      }

      logger.info('Sleeping until next check...');
    } catch (error: any) {
      logger.error('Error during scheduled job:', error.message);
    }
  });

  logger.info(`Scheduler started. Checking interval: ${checkInterval}`);
};
