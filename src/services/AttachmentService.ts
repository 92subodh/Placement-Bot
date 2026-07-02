import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ApiService } from '../api/ApiService';
import { logger } from '../utils/logger';

export class AttachmentService {
  // Persistent directory — files are kept here indefinitely
  private static attachmentsDir = path.join(__dirname, '../../attachments');

  static {
    if (!fs.existsSync(this.attachmentsDir)) {
      fs.mkdirSync(this.attachmentsDir, { recursive: true });
    }
  }

  /**
   * Returns the deterministic local file path for an attachment.
   * Using portalAttachmentId ensures the same file always has the same path.
   */
  public static getLocalPath(attachmentId: string, originalFileName: string): string {
    // Sanitize filename to avoid path issues
    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.attachmentsDir, `${attachmentId}-${safeFileName}`);
  }

  /**
   * Returns the file if it already exists locally. If not, downloads it from S3.
   * Never downloads the same file twice.
   */
  public static async getOrDownloadAttachment(attachmentId: string, originalFileName: string): Promise<string | null> {
    const filePath = this.getLocalPath(attachmentId, originalFileName);

    // If file already exists on disk, return it immediately — no download needed
    if (fs.existsSync(filePath)) {
      logger.info(`Attachment already on disk, reusing: ${originalFileName}`);
      return filePath;
    }

    // Otherwise, download it fresh from S3
    return await this.downloadAttachment(attachmentId, originalFileName, filePath);
  }

  /**
   * Downloads an attachment from the pre-signed S3 URL to local disk.
   */
  private static async downloadAttachment(attachmentId: string, originalFileName: string, filePath: string): Promise<string | null> {
    try {
      const s3Url = await ApiService.getAttachmentDownloadUrl(attachmentId);

      if (!s3Url || !s3Url.startsWith('http')) {
        logger.error(`Invalid S3 URL received for attachment ${attachmentId}`);
        return null;
      }

      logger.info(`Downloading attachment: ${originalFileName}`);

      const response = await axios({
        url: s3Url.trim(),
        method: 'GET',
        responseType: 'stream',
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info(`Saved attachment to disk: ${filePath}`);
          resolve(filePath);
        });
        writer.on('error', (err) => {
          logger.error('Error writing attachment to disk:', err);
          reject(err);
        });
      });
    } catch (error: any) {
      logger.error(`Failed to download attachment ${attachmentId}:`, error.message);
      return null;
    }
  }
}
