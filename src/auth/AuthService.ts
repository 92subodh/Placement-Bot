import axios from 'axios';
import { prisma } from '../database';
import { logger } from '../utils/logger';

export class AuthService {
  private static jwtToken: string | null = null;

  /**
   * Fetches a fresh JWT token using the stored session cookie.
   */
  public static async getFreshToken(): Promise<string | null> {
    try {
      const config = await prisma.config.findUnique({
        where: { key: 'SESSION_COOKIE' }
      });

      if (!config || !config.value) {
        logger.error('No session cookie found in database.');
        return null;
      }

      const sessionCookie = config.value;
      const baseUrl = process.env.API_BASE_URL || 'https://www.aitplacements.in';

      const response = await axios.get(`${baseUrl}/api/auth/token`, {
        headers: {
          'Cookie': `__Secure-better-auth.session_token=${sessionCookie}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PlacementBot/1.0',
        },
        timeout: 10000,
      });

      if (response.data && response.data.token) {
        this.jwtToken = response.data.token;
        return this.jwtToken;
      }

      logger.error('Failed to parse token from /api/auth/token response', response.data);
      return null;
    } catch (error: any) {
      logger.error('Error fetching fresh token:', error.message);
      if (error.response) {
        logger.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  /**
   * Retrieves the current token in memory, or fetches a new one if not available.
   * Useful for immediate successive calls within a short timeframe.
   */
  public static async getToken(forceRefresh: boolean = false): Promise<string | null> {
    if (!this.jwtToken || forceRefresh) {
      return await this.getFreshToken();
    }
    return this.jwtToken;
  }
}
