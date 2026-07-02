import axios, { AxiosInstance } from 'axios';
import { AuthService } from '../auth/AuthService';
import { logger } from '../utils/logger';

export class ApiService {
  private static client: AxiosInstance;

  static {
    const baseURL = process.env.API_BASE_URL || 'https://www.aitplacements.in';
    this.client = axios.create({
      baseURL,
      timeout: 15000,
    });

    // Request interceptor to attach JWT
    this.client.interceptors.request.use(
      async (config) => {
        // Only attach Bearer token if it's not the /auth/token endpoint
        if (!config.url?.includes('/api/auth/token')) {
          const token = await AuthService.getToken();
          if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor to handle 401s
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          logger.warn('Received 401 Unauthorized, attempting to refresh token...');
          const newToken = await AuthService.getToken(true);
          if (newToken) {
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            return this.client(originalRequest);
          } else {
            logger.error('Failed to refresh token after 401 Unauthorized.');
            // Implement logic to notify admin via Telegram here if desired
          }
        }
        return Promise.reject(error);
      }
    );
  }

  public static async fetchPosts(limit = 10, offset = 0) {
    const response = await this.client.get('/api/post/list', {
      params: { limit, offset, sort: 'desc', order: 'asc', status: 'published' }
    });
    return response.data;
  }

  public static async fetchPostDetails(postId: string) {
    const response = await this.client.get(`/api/post/${postId}`);
    return response.data;
  }

  public static async fetchAttachments(postId: string) {
    const response = await this.client.get('/api/attachment', {
      params: { postId }
    });
    return response.data;
  }

  public static async getAttachmentDownloadUrl(attachmentId: string): Promise<string> {
    const response = await this.client.get('/api/attachment/download', {
      params: { id: attachmentId },
      // API returns plain text URL according to spec
      responseType: 'text'
    });
    return response.data;
  }
}
