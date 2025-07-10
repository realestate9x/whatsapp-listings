import { createAuthenticatedSupabaseClient } from "../lib/supabase";

interface UserSession {
  userId: string;
  token: string;
  lastActive: Date;
}

export class UserSessionManager {
  private activeSessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  addSession(userId: string, token: string) {
    this.activeSessions.set(userId, {
      userId,
      token,
      lastActive: new Date(),
    });

    // Clean up old sessions
    this.cleanupExpiredSessions();
  }

  getActiveSession(): UserSession | null {
    // Return the most recently active session
    let mostRecent: UserSession | null = null;
    let latestTime = 0;

    for (const session of this.activeSessions.values()) {
      const sessionTime = session.lastActive.getTime();
      if (sessionTime > latestTime && !this.isSessionExpired(session)) {
        mostRecent = session;
        latestTime = sessionTime;
      }
    }

    return mostRecent;
  }

  removeSession(userId: string) {
    this.activeSessions.delete(userId);
  }

  private isSessionExpired(session: UserSession): boolean {
    const now = new Date().getTime();
    const sessionTime = session.lastActive.getTime();
    return now - sessionTime > this.SESSION_TIMEOUT;
  }

  private cleanupExpiredSessions() {
    for (const [userId, session] of this.activeSessions.entries()) {
      if (this.isSessionExpired(session)) {
        this.activeSessions.delete(userId);
      }
    }
  }

  updateLastActive(userId: string) {
    const session = this.activeSessions.get(userId);
    if (session) {
      session.lastActive = new Date();
    }
  }

  getAllActiveSessions(): UserSession[] {
    return Array.from(this.activeSessions.values()).filter(
      (session) => !this.isSessionExpired(session)
    );
  }
}
