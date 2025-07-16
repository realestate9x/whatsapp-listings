import { GroqRealEstateParser } from "./groq-parser";
import { DatabaseService } from "./database";
import pino from "pino";

export class RealEstateParsingJob {
  private parser: GroqRealEstateParser;
  private database: DatabaseService;
  private logger: pino.Logger;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(logger?: pino.Logger) {
    this.parser = new GroqRealEstateParser();
    this.database = new DatabaseService();
    this.logger = logger || pino({ level: "info" });
  }

  async processUnprocessedMessages(batchSize = 10): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    try {
      this.logger.info("Starting to process unprocessed messages...");

      const messages = await this.database.getUnprocessedMessages(batchSize);

      if (messages.length === 0) {
        this.logger.info("No unprocessed messages found");
        return result;
      }

      this.logger.info(`Found ${messages.length} unprocessed messages`);

      // Filter out messages without text content
      const validMessages = messages.filter(
        (msg) => msg.message_text && msg.message_text.trim().length > 0
      );

      if (validMessages.length === 0) {
        this.logger.info("No messages with valid text content found");
        // Mark all messages as processed
        for (const message of messages) {
          await this.database.markMessageAsProcessed(message.id);
        }
        return result;
      }

      // Process messages in batch
      try {
        this.logger.info(
          `Processing ${validMessages.length} messages in batch`
        );

        const messageTexts = validMessages.map((msg) => msg.message_text);
        const results = await this.parser.parseRealEstateMessagesBatch(
          messageTexts
        );

        // Process each result
        for (let i = 0; i < validMessages.length; i++) {
          const message = validMessages[i];
          const parseResult = results[i];

          try {
            result.processed++;

            this.logger.debug(
              `Processing result for message ${message.id} from ${message.group_name}`
            );

            // Handle multiple properties per message
            const properties = parseResult.properties || [];

            this.logger.info(
              `Found ${properties.length} properties for message ${message.id}`
            );

            let savedAnyProperty = false;

            // Process each property from the message
            for (const propertyData of properties) {
              // Log the parsed data for debugging
              this.logger.info(
                `Parsed property data for message ${message.id}:`,
                {
                  listing_type: propertyData.listing_type,
                  confidence: propertyData.parsing_confidence,
                  property_type: propertyData.property_type,
                  location: propertyData.location,
                  price: propertyData.price,
                  raw_message: message.message_text.substring(0, 100) + "...", // First 100 chars
                }
              );

              // Only save if we have a valid listing type and reasonable confidence
              if (
                propertyData.listing_type &&
                propertyData.parsing_confidence &&
                propertyData.parsing_confidence > 0.3
              ) {
                await this.database.saveParsedProperty(
                  message.id,
                  message.user_id,
                  propertyData,
                  message.message_text,
                  parseResult.rawResponse
                );

                this.logger.info(
                  `Successfully parsed property from message ${message.id}`,
                  {
                    property_type: propertyData.property_type,
                    listing_type: propertyData.listing_type,
                    location: propertyData.location,
                    confidence: propertyData.parsing_confidence,
                  }
                );

                savedAnyProperty = true;
              } else {
                this.logger.info(
                  `Skipping property from message ${message.id} - low confidence or invalid listing type`,
                  {
                    listing_type: propertyData.listing_type,
                    confidence: propertyData.parsing_confidence,
                    property_type: propertyData.property_type,
                    location: propertyData.location,
                    price: propertyData.price,
                    reason: !propertyData.listing_type
                      ? "No listing type"
                      : !propertyData.parsing_confidence
                      ? "No confidence score"
                      : propertyData.parsing_confidence <= 0.3
                      ? "Low confidence"
                      : "Unknown",
                  }
                );
              }
            }

            if (savedAnyProperty) {
              result.successful++;
            }

            // Mark as processed regardless of whether we saved any properties
            await this.database.markMessageAsProcessed(message.id);
          } catch (error) {
            result.failed++;
            const errorMessage = `Failed to process message ${message.id}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`;
            result.errors.push(errorMessage);
            this.logger.error(errorMessage, { messageId: message.id, error });

            // Mark as processed even if saving failed to avoid reprocessing
            try {
              await this.database.markMessageAsProcessed(message.id);
            } catch (markError) {
              this.logger.error(
                `Failed to mark message ${message.id} as processed:`,
                markError
              );
            }
          }
        }
      } catch (batchError) {
        this.logger.error("Error in batch processing:", batchError);

        // Fallback: mark all messages as processed to avoid infinite retry
        for (const message of validMessages) {
          result.failed++;
          const errorMessage = `Batch processing failed for message ${
            message.id
          }: ${
            batchError instanceof Error ? batchError.message : "Unknown error"
          }`;
          result.errors.push(errorMessage);

          try {
            await this.database.markMessageAsProcessed(message.id);
          } catch (markError) {
            this.logger.error(
              `Failed to mark message ${message.id} as processed:`,
              markError
            );
          }
        }
      }

      // Mark any remaining messages (those without text) as processed
      const remainingMessages = messages.filter(
        (msg) => !msg.message_text || msg.message_text.trim().length === 0
      );
      for (const message of remainingMessages) {
        try {
          await this.database.markMessageAsProcessed(message.id);
          this.logger.debug(
            `Marked message ${message.id} as processed (no text content)`
          );
        } catch (error) {
          this.logger.error(
            `Failed to mark message ${message.id} as processed:`,
            error
          );
        }
      }

      this.logger.info("Batch processing completed", result);
      return result;
    } catch (error) {
      const errorMessage = `Fatal error during batch processing: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      result.errors.push(errorMessage);
      this.logger.error(errorMessage, { error });
      throw error;
    }
  }

  async startRecurringJob(intervalMinutes = 5): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Recurring job is already running");
      return;
    }

    this.isRunning = true;
    this.logger.info(
      `Starting recurring real estate parsing job (interval: ${intervalMinutes} minutes)`
    );

    const runJob = async () => {
      if (!this.isRunning) return;

      try {
        const result = await this.processUnprocessedMessages();

        if (result.processed > 0) {
          this.logger.info(
            `Recurring job completed: ${result.successful}/${result.processed} messages processed successfully`
          );
        }
      } catch (error) {
        this.logger.error("Error in recurring job:", error);
      }
    };

    // Run immediately
    await runJob();

    // Set up recurring execution
    this.intervalId = setInterval(runJob, intervalMinutes * 60 * 1000);

    this.logger.info("Recurring job started successfully");
  }

  stopRecurringJob(): void {
    if (!this.isRunning) {
      this.logger.warn("Recurring job is not running");
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.logger.info("Recurring job stopped");
  }

  async getJobStatus(): Promise<{
    isRunning: boolean;
    stats: {
      totalMessages: number;
      processedMessages: number;
      unprocessedMessages: number;
      totalParsedProperties: number;
      averageConfidence: number;
    };
  }> {
    const stats = await this.database.getProcessingStats();

    return {
      isRunning: this.isRunning,
      stats,
    };
  }

  async searchProperties(filters: {
    listing_type?: "sale" | "rental" | "lease";
    property_type?: string;
    location?: string;
    min_price?: number;
    max_price?: number;
    bedrooms?: number;
    min_parking_count?: number;
    min_confidence?: number;
    limit?: number;
  }) {
    return await this.database.searchParsedProperties(filters);
  }
}
