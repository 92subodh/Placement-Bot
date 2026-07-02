import { prisma } from '../database';

export class FilterService {
  /**
   * Evaluates which users should receive a notification for a given post based on their subscriptions.
   * If a user has NO subscriptions, they receive EVERYTHING.
   * If they have subscriptions, at least one keyword must match either the title or the body.
   * Matching is case-insensitive and partial.
   */
  public static async getMatchedUsersForPost(title: string, plainTextBody: string): Promise<string[]> {
    const allUsers = await prisma.user.findMany({
      include: { subscriptions: true }
    });

    const matchedUserIds: string[] = [];

    const searchString = `${title} ${plainTextBody}`.toLowerCase();

    for (const user of allUsers) {
      if (user.subscriptions.length === 0) {
        // No subscriptions = receive all posts
        matchedUserIds.push(user.id);
        continue;
      }

      // Check if any subscription matches
      const isMatch = user.subscriptions.some(sub => {
        return searchString.includes(sub.keyword.toLowerCase());
      });

      if (isMatch) {
        matchedUserIds.push(user.id);
      }
    }

    return matchedUserIds;
  }
}
