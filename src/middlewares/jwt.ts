import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { NotAuthorizedError } from "../errors/not-authorized-error";

export interface UserJwt {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email: string;
  phone?: string;
  app_metadata?: AppMetadata;
  user_metadata?: UserMetadata;
  role?: string;
  aal?: string;
  amr?: AMR[];
  session_id?: string;
  is_anonymous?: boolean;
}

export interface AMR {
  method: string;
  timestamp: number;
}

export interface AppMetadata {
  provider: string;
  providers: string[];
}

export interface UserMetadata {
  brand_name?: string;
  contact_name?: string;
  description?: string;
  email: string;
  email_verified?: boolean;
  phone?: string;
  phone_verified?: boolean;
  sub: string;
  website_url?: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: UserJwt;
    }
  }
}

export function jwtMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer "))
      throw new NotAuthorizedError("No token provided");

    const token = authHeader.split(" ")[1];

    // For Supabase JWT tokens, we can decode without verification
    // In production, you might want to verify the signature using the JWT secret
    const decoded = jwt.decode(token);

    if (!decoded) throw new NotAuthorizedError("Invalid token");

    req.user = decoded as UserJwt;
    next();
  } catch (error) {
    console.error("JWT Middleware Error:", error);
    next(error);
  }
}

// Optional: JWT verification middleware if you want to verify signatures
export function jwtVerifyMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer "))
        throw new NotAuthorizedError("No token provided");

      const token = authHeader.split(" ")[1];

      // Verify the token signature
      const decoded = jwt.verify(token, secret);

      if (!decoded) throw new NotAuthorizedError("Invalid token");

      req.user = decoded as UserJwt;
      next();
    } catch (error) {
      console.error("JWT Verify Middleware Error:", error);
      next(error);
    }
  };
}
