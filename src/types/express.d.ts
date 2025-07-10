import { WhatsAppServiceManager } from "../services/whatsapp-service-manager";

declare global {
  namespace Express {
    interface Locals {
      whatsappServiceManager: WhatsAppServiceManager;
    }
  }
}

export {};
