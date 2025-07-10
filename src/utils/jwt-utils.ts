import jwt from "jsonwebtoken";
import { UserJwt } from "../middlewares/jwt";

export interface CreateTokenOptions {
  email: string;
  sub: string;
  role?: string;
  phone?: string;
  expiresIn?: string;
}

export function createJwtToken(
  payload: CreateTokenOptions,
  secret: string,
  options?: jwt.SignOptions
): string {
  const defaultPayload: Partial<UserJwt> = {
    iss: "realestate-app",
    sub: payload.sub,
    aud: "authenticated",
    email: payload.email,
    phone: payload.phone,
    role: payload.role || "user",
    iat: Math.floor(Date.now() / 1000),
    exp:
      Math.floor(Date.now() / 1000) +
      (options?.expiresIn
        ? parseExpiresIn(payload.expiresIn || "24h")
        : 24 * 60 * 60), // 24 hours default
    is_anonymous: false,
  };

  return jwt.sign(defaultPayload, secret, options);
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([hmd])$/);
  if (!match) return 24 * 60 * 60; // default 24 hours

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 24 * 60 * 60;
    case "m":
      return value * 60;
    default:
      return 24 * 60 * 60;
  }
}

export function verifyJwtToken(token: string, secret: string): UserJwt {
  return jwt.verify(token, secret) as UserJwt;
}
