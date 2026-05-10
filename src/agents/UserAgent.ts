import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface UserContext {
  email: string;
  likes: string[];
  dislikes: string[];
  isFlagged: boolean;
  securityNotes: string;
}

export class UserAgent {
  /**
   * Identifies the user and retrieves their context from the database.
   * If the user doesn't exist, it creates a new entry.
   */
  async getOrCreateUser(email: string): Promise<UserContext> {
    let user = await prisma.user.findUnique({
      where: { id: email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: email,
          likes: '',
          dislikes: '',
        },
      });
    }

    return {
      email: user.id,
      likes: user.likes ? user.likes.split(',') : [],
      dislikes: user.dislikes ? user.dislikes.split(',') : [],
      isFlagged: user.isFlagged,
      securityNotes: user.securityFlags || '',
    };
  }

  /**
   * Analyzes input for potential security threats and flags the user if necessary.
   */
  async checkSecurity(email: string, input: string): Promise<{ safe: boolean; reason?: string }> {
    // Basic prompt injection patterns
    const exploitPatterns = [
      /ignore previous instructions/i,
      /system prompt/i,
      /you are now a/i,
      /reveal your keys/i,
      /<script>/i,
      /javascript:/i,
    ];

    for (const pattern of exploitPatterns) {
      if (pattern.test(input)) {
        await prisma.user.update({
          where: { id: email },
          data: {
            isFlagged: true,
            securityFlags: {
              set: `Attempted exploit detected: ${input.substring(0, 100)}...`,
            },
          },
        });
        return { safe: false, reason: "Security violation detected. Interaction logged." };
      }
    }

    return { safe: true };
  }

  /**
   * Updates user preferences based on interaction.
   */
  async updatePreferences(email: string, likes: string[], dislikes: string[]): Promise<void> {
    await prisma.user.update({
      where: { id: email },
      data: {
        likes: likes.join(','),
        dislikes: dislikes.join(','),
      },
    });
  }

  /**
   * Logs a message to the user's history.
   */
  async logInteraction(email: string, role: 'user' | 'assistant', content: string): Promise<void> {
    await prisma.message.create({
      data: {
        role,
        content,
        userId: email,
      },
    });
    
    await prisma.user.update({
      where: { id: email },
      data: {
        interactions: { increment: 1 },
        lastSeen: new Date(),
      },
    });
  }
}
