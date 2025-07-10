import { WhatsAppService } from "./whatsapp-service";

export class WhatsAppServiceManager {
  private userServices = new Map<string, WhatsAppService>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly CLEANUP_DELAY = 30 * 60 * 1000; // 30 minutes of inactivity

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
    }

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

    for (const [userId, service] of services) {
      const status = service.getConnectionStatus();

      // Remove services that are not connected and have no recent activity
      if (!status.isConnected && !status.qrCode) {
        console.log(`🧹 Cleaning up inactive service for user: ${userId}`);
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
}
