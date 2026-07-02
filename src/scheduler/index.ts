import cron from 'node-cron';
import { ApiService } from '../api/ApiService';
import { AttachmentService } from '../services/AttachmentService';
import { FilterService } from '../services/FilterService';
import { HtmlParserService } from '../services/HtmlParserService';
import { prisma } from '../database';
import { bot } from '../telegram';
import { logger } from '../utils/logger';

export const startScheduler = () => {
  const checkInterval = process.env.CHECK_INTERVAL || '*/2 * * * *';

  cron.schedule(checkInterval, async () => {
    logger.info('Running scheduled job to fetch latest posts...');
    try {
      // 1. Fetch latest posts (limit 10 for safety)
      const data = await ApiService.fetchPosts(10, 0);
      
      if (!data || !data.posts) {
        logger.error('Invalid response from /api/post/list');
        return;
      }

      const latestPosts = data.posts;
      
      for (const post of latestPosts.reverse()) { // Process oldest first to maintain chronological order in notifications
        // 2. Compare against DB to identify new posts
        const exists = await prisma.post.findUnique({ where: { id: post.id } });
        
        if (!exists) {
          logger.info(`New post detected: ${post.title}`);

          // 3. Fetch full details
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
            }
          });

          // 4. Fetch attachments
          const attachmentData = await ApiService.fetchAttachments(details.id);
          const localFilesToCleanup: string[] = [];
          const filesToSend: { path: string, name: string }[] = [];

          if (attachmentData && attachmentData.attachments) {
            for (const att of attachmentData.attachments) {
              await prisma.attachment.create({
                data: {
                  portalAttachmentId: att.id,
                  postId: savedPost.id,
                  originalFileName: att.originalFileName,
                  s3Key: att.s3Key,
                  mimeType: att.fileType,
                  fileSize: att.fileSize,
                  status: att.status,
                  createdAtPortal: new Date(att.createdAt || Date.now()),
                  updatedAtPortal: new Date(att.updatedAt || Date.now()),
                }
              });

              // Prepare for download if bot is active
              if (bot) {
                const localPath = await AttachmentService.downloadAttachment(att.id, att.originalFileName);
                if (localPath) {
                  filesToSend.push({ path: localPath, name: att.originalFileName });
                  localFilesToCleanup.push(localPath);
                }
              }
            }
          }

          // Prepare Message
          const message = `📢 *New Placement Update*\n\n🏢 *Title*\n${savedPost.title}\n\n📅 *Posted*\n${savedPost.portalCreatedAt.toISOString().split('T')[0]}\n\n📝 *Details*\n${savedPost.content}\n\n👤 *Posted By*\n${savedPost.author}`;

          // Broadcast to Channel if configured
          const channelId = process.env.CHANNEL_ID;
          if (bot && channelId) {
            try {
              await bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
              for (const file of filesToSend) {
                await bot.sendDocument(channelId, file.path);
              }
              logger.info(`Broadcasted post ${savedPost.id} to channel ${channelId}`);
            } catch (error: any) {
              logger.error(`Failed to send to channel ${channelId}: ${error.message}`);
            }
          }

          // 5. Match posts against user subscriptions
          const matchedUsers = await FilterService.getMatchedUsersForPost(savedPost.title, savedPost.content);
          
          if (bot && matchedUsers.length > 0) {
            for (const userId of matchedUsers) {
              const user = await prisma.user.findUnique({ where: { id: userId } });
              if (user && user.telegramId) {
                try {
                  // Send main message
                  await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                  
                  // Send attachments
                  for (const file of filesToSend) {
                    await bot.sendDocument(user.telegramId, file.path);
                  }
                  
                  // Log Notification
                  await prisma.notification.create({
                    data: {
                      postId: savedPost.id,
                      userId: user.id,
                      status: 'SENT'
                    }
                  });
                } catch (error: any) {
                  logger.error(`Failed to send notification to ${user.telegramId}: ${error.message}`);
                  await prisma.notification.create({
                    data: {
                      postId: savedPost.id,
                      userId: user.id,
                      status: 'FAILED'
                    }
                  });
                }
              }
            }
          }
          
          // Cleanup attachments locally
          for (const file of localFilesToCleanup) {
            AttachmentService.cleanupFile(file);
          }
        }
      }
    } catch (error: any) {
      logger.error('Error during scheduled job:', error.message);
    }
  });

  logger.info(`Scheduler started. Checking interval: ${checkInterval}`);
};
