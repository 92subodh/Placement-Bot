import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ApiService } from '../api/ApiService';
import { logger } from '../utils/logger';

export class AttachmentService {
  private static tempDir = path.join(__dirname, '../../temp_downloads');

  static {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Downloads an attachment from the pre-signed S3 URL to local disk.
   * Returns the local file path.
   */
  public static async downloadAttachment(attachmentId: string, originalFileName: string): Promise<string | null> {
    try {
      // 1. Get the S3 URL
      const s3Url = await ApiService.getAttachmentDownloadUrl(attachmentId);
      
      if (!s3Url || !s3Url.startsWith('http')) {
        logger.error(`Invalid S3 URL received for attachment ${attachmentId}`);
        return null;
      }

      // 2. Download the file from S3
      const response = await axios({
        url: s3Url.trim(),
        method: 'GET',
        responseType: 'stream',
      });

      // Ensure unique filename to prevent collisions
      const uniqueFileName = `${Date.now()}-${originalFileName}`;
      const filePath = path.join(this.tempDir, uniqueFileName);

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath));
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

  /**
   * Deletes a local temporary file.
   */
  public static cleanupFile(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      logger.error(`Failed to clean up file ${filePath}:`, error);
    }
  }
}
