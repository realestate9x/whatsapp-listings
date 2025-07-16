import express from "express";
import { RealEstateParsingJob } from "../services/real-estate-job";
import { jwtMiddleware } from "../middlewares/jwt";

const router = express.Router();
let parsingJob: RealEstateParsingJob;

// Initialize the parsing job
const initializeParsingJob = (logger?: any) => {
  if (!parsingJob) {
    parsingJob = new RealEstateParsingJob(logger);
  }
  return parsingJob;
};

// Start the parsing job - requires authentication
router.post("/start", jwtMiddleware, async (req, res) => {
  try {
    const { interval = 5 } = req.body; // Default 5 minutes
    const job = initializeParsingJob(req.log);

    await job.startRecurringJob(interval);

    res.json({
      status: "success",
      message: `Real estate parsing job started with ${interval} minute interval`,
      isRunning: true,
    });
  } catch (error) {
    console.error("Error starting parsing job:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to start parsing job",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Stop the parsing job - requires authentication
router.post("/stop", jwtMiddleware, async (req, res) => {
  try {
    const job = initializeParsingJob(req.log);
    job.stopRecurringJob();

    res.json({
      status: "success",
      message: "Real estate parsing job stopped",
      isRunning: false,
    });
  } catch (error) {
    console.error("Error stopping parsing job:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to stop parsing job",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Process messages manually - requires authentication
router.post("/process", jwtMiddleware, async (req, res) => {
  try {
    const { batchSize = 10 } = req.body;
    const job = initializeParsingJob(req.log);

    const result = await job.processUnprocessedMessages(batchSize);

    res.json({
      status: "success",
      message: "Manual processing completed",
      result,
    });
  } catch (error) {
    console.error("Error processing messages:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to process messages",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Process messages manually with custom confidence threshold - requires authentication
router.post("/process-debug", jwtMiddleware, async (req, res) => {
  try {
    const { batchSize = 10, minConfidence = 0.1 } = req.body;
    const job = initializeParsingJob(req.log);

    // Temporarily override the confidence threshold for debugging
    const originalProcessMethod = job.processUnprocessedMessages.bind(job);
    job.processUnprocessedMessages = async (batchSize = 10) => {
      const result = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };

      try {
        const messages = await job["database"].getUnprocessedMessages(
          batchSize
        );

        if (messages.length === 0) {
          return result;
        }

        const validMessages = messages.filter(
          (msg) => msg.message_text && msg.message_text.trim().length > 0
        );

        if (validMessages.length === 0) {
          for (const message of messages) {
            await job["database"].markMessageAsProcessed(message.id);
          }
          return result;
        }

        const messageTexts = validMessages.map((msg) => msg.message_text);
        const results = await job["parser"].parseRealEstateMessagesBatch(
          messageTexts
        );

        for (let i = 0; i < validMessages.length; i++) {
          const message = validMessages[i];
          const parseResult = results[i];

          try {
            result.processed++;

            // Handle multiple properties per message
            const properties = parseResult.properties || [];
            let savedAnyProperty = false;

            // Process each property from the message
            for (const propertyData of properties) {
              // Use custom confidence threshold
              if (
                propertyData.listing_type &&
                propertyData.parsing_confidence &&
                propertyData.parsing_confidence > minConfidence
              ) {
                await job["database"].saveParsedProperty(
                  message.id,
                  message.user_id,
                  propertyData,
                  message.message_text,
                  parseResult.rawResponse
                );
                savedAnyProperty = true;
              }
            }

            if (savedAnyProperty) {
              result.successful++;
            }

            await job["database"].markMessageAsProcessed(message.id);
          } catch (error) {
            result.failed++;
            result.errors.push(
              `Failed to process message ${message.id}: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );

            try {
              await job["database"].markMessageAsProcessed(message.id);
            } catch (markError) {
              // Ignore mark errors in debug mode
            }
          }
        }

        return result;
      } catch (error) {
        result.errors.push(
          `Fatal error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        throw error;
      }
    };

    const result = await job.processUnprocessedMessages(batchSize);

    // Restore original method
    job.processUnprocessedMessages = originalProcessMethod;

    res.json({
      status: "success",
      message: `Debug processing completed with confidence threshold ${minConfidence}`,
      result,
    });
  } catch (error) {
    console.error("Error in debug processing:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to process messages in debug mode",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get job status - requires authentication
router.get("/status", jwtMiddleware, async (req, res) => {
  try {
    const job = initializeParsingJob(req.log);
    const status = await job.getJobStatus();

    res.json({
      status: "success",
      data: status,
    });
  } catch (error) {
    console.error("Error getting job status:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get job status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Search parsed properties - requires authentication
router.get("/properties", jwtMiddleware, async (req, res) => {
  try {
    const job = initializeParsingJob(req.log);

    const filters = {
      listing_type: req.query.listing_type as
        | "sale"
        | "rental"
        | "lease"
        | undefined,
      property_type: req.query.property_type as string | undefined,
      location: req.query.location as string | undefined,
      min_price: req.query.min_price
        ? parseInt(req.query.min_price as string)
        : undefined,
      max_price: req.query.max_price
        ? parseInt(req.query.max_price as string)
        : undefined,
      bedrooms: req.query.bedrooms
        ? parseInt(req.query.bedrooms as string)
        : undefined,
      min_parking_count: req.query.min_parking_count
        ? parseInt(req.query.min_parking_count as string)
        : undefined,
      min_confidence: req.query.min_confidence
        ? parseFloat(req.query.min_confidence as string)
        : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };

    const properties = await job.searchProperties(filters);

    res.json({
      status: "success",
      data: properties,
      count: properties.length,
    });
  } catch (error) {
    console.error("Error searching properties:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to search properties",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get recent unprocessed messages for debugging - requires authentication
router.get("/unprocessed-messages", jwtMiddleware, async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const job = initializeParsingJob(req.log);

    const messages = await job["database"].getUnprocessedMessages(
      parseInt(limit as string)
    );

    res.json({
      status: "success",
      data: messages.map((msg) => ({
        id: msg.id,
        group_name: msg.group_name,
        sender: msg.sender,
        message_text:
          msg.message_text?.substring(0, 200) +
          (msg.message_text?.length > 200 ? "..." : ""),
        timestamp: msg.created_at,
        processed: msg.processed,
      })),
      count: messages.length,
    });
  } catch (error) {
    console.error("Error getting unprocessed messages:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get unprocessed messages",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Public endpoint for basic stats (no auth required)
router.get("/stats", async (req, res) => {
  try {
    const job = initializeParsingJob();
    const status = await job.getJobStatus();

    res.json({
      status: "success",
      data: {
        isRunning: status.isRunning,
        totalMessages: status.stats.totalMessages,
        processedMessages: status.stats.processedMessages,
        totalParsedProperties: status.stats.totalParsedProperties,
        averageConfidence:
          Math.round(status.stats.averageConfidence * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to get stats",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
