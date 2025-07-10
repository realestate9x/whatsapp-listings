import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error("Error:", err);

  // Handle specific error types
  if (err.name === "NotAuthorizedError") {
    res.status(401).json({
      error: "Not authorized",
      message: err.message,
    });
    return;
  }

  // Default error response
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
}
