import { WhatsAppService } from "./whatsapp-service";

export class WhatsAppServiceManager {
  private userServices = new Map<string, WhatsAppService>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();
  private userLastActivity = new Map<string, number>();
  private readonly CLEANUP_DELAY = 2 * 60 * 60 * 1000; // 2 hours of inactivity (increased from 30 min)
  private readonly ACTIVITY_THRESHOLD = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Cleanup inactive services periodically
    setInterval(() => this.cleanupInactiveServices(), 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Get or create a WhatsApp service for a specific user
   */
  getServiceForUser(userId: string): WhatsAppService {
    let service = this.userServices.get(userId);

    if (!service) {
      console.log(`📱 Creating new WhatsApp service for user: ${userId}`);
      service = new WhatsAppService(userId);
      this.userServices.set(userId, service);

      // Set logout callback to automatically remove service when user logs out
      service.setLogoutCallback(() => {
        console.log(`🚪 Auto-removing service for logged out user: ${userId}`);
        this.removeUserService(userId).catch((error) => {
          console.error(
            `Error removing service for logged out user ${userId}:`,
            error
          );
        });
      });

      // Auto-start if possible when creating a new service
      service
        .autoStartIfPossible()
        .then((started) => {
          if (started) {
            console.log(
              `🔄 Auto-started WhatsApp connection for user: ${userId}`
            );
          }
        })
        .catch((error) => {
          console.error(
            `❌ Failed to auto-start WhatsApp for user ${userId}:`,
            error
          );
        });
    }

    // Track user activity
    this.userLastActivity.set(userId, Date.now());

    // Reset cleanup timer for this user
    this.resetCleanupTimer(userId);

    return service;
  }

  /**
   * Get all active user services
   */
  getAllServices(): Map<string, WhatsAppService> {
    return new Map(this.userServices);
  }

  /**
   * Get service if it exists (don't create new one)
   */
  getExistingService(userId: string): WhatsAppService | undefined {
    // Track user activity even when just checking existing service
    if (this.userServices.has(userId)) {
      this.userLastActivity.set(userId, Date.now());
    }
    return this.userServices.get(userId);
  }

  /**
   * Remove a user's service and cleanup resources
   */
  async removeUserService(userId: string): Promise<void> {
    const service = this.userServices.get(userId);
    if (service) {
      console.log(`🧹 Removing WhatsApp service for user: ${userId}`);
      await service.cleanup();
      this.userServices.delete(userId);
      this.userLastActivity.delete(userId);

      // Clear cleanup timer
      const timer = this.cleanupTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        this.cleanupTimers.delete(userId);
      }
    }
  }

  /**
   * Reset the cleanup timer for a user (extends their session)
   */
  private resetCleanupTimer(userId: string): void {
    // Clear existing timer
    const existingTimer = this.cleanupTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new cleanup timer
    const timer = setTimeout(async () => {
      const service = this.userServices.get(userId);
      if (service) {
        const status = service.getConnectionStatus();
        if (!status.isConnected) {
          console.log(
            `⏰ Auto-removing inactive WhatsApp service for user: ${userId}`
          );
          await this.removeUserService(userId);
        } else {
          // If still connected, extend the timer
          this.resetCleanupTimer(userId);
        }
      }
    }, this.CLEANUP_DELAY);

    this.cleanupTimers.set(userId, timer);
  }

  /**
   * Cleanup services that have been inactive
   */
  private async cleanupInactiveServices(): Promise<void> {
    const services = Array.from(this.userServices.entries());
    const now = Date.now();

    for (const [userId, service] of services) {
      const lastActivity = this.userLastActivity.get(userId) || 0;
      const inactiveTime = now - lastActivity;
      const status = service.getConnectionStatus();

      // Only cleanup if user has been inactive for a long time AND is not connected
      if (
        inactiveTime > this.ACTIVITY_THRESHOLD &&
        !status.isConnected &&
        !status.qrCode
      ) {
        console.log(
          `🧹 Cleaning up inactive service for user: ${userId} (inactive for ${Math.round(
            inactiveTime / 1000 / 60
          )} minutes)`
        );
        await this.removeUserService(userId);
      }
    }
  }

  /**
   * Cleanup all services (for app shutdown)
   */
  async cleanupAll(): Promise<void> {
    console.log(
      `🛑 Cleaning up all WhatsApp services (${this.userServices.size} services)`
    );

    // Clear all timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.userLastActivity.clear();

    // Cleanup all services
    const cleanupPromises = Array.from(this.userServices.values()).map(
      (service) =>
        service
          .cleanup()
          .catch((error) => console.error("Error cleaning up service:", error))
    );

    await Promise.all(cleanupPromises);
    this.userServices.clear();

    console.log("✅ All WhatsApp services cleaned up");
  }

  /**
   * Get status of all user services
   */
  getAllServicesStatus(): { [userId: string]: any } {
    const status: { [userId: string]: any } = {};

    for (const [userId, service] of this.userServices.entries()) {
      status[userId] = service.getConnectionStatus();
    }

    return status;
  }

  /**
   * Handle user logout - clean up auth data and remove service
   */
  async handleUserLogout(userId: string): Promise<void> {
    const service = this.userServices.get(userId);
    if (service) {
      console.log(`🚪 Handling logout for user: ${userId}`);
      await service.handleLogout();
      await this.removeUserService(userId);
      console.log(`✅ Logout handled for user: ${userId}`);
    }
  }
}
