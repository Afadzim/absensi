import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

import { AUTH_CONSTANTS } from "./auth.constants.js";

function assertPasswordLength(password: string): void {
  if (
    password.length < AUTH_CONSTANTS.PASSWORD_MIN_LENGTH ||
    password.length > AUTH_CONSTANTS.PASSWORD_MAX_LENGTH
  ) {
    throw new Error("Password length is outside the allowed range.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordLength(password);

  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: AUTH_CONSTANTS.ARGON2_MEMORY_COST_KIB,
    timeCost: AUTH_CONSTANTS.ARGON2_TIME_COST,
    parallelism: AUTH_CONSTANTS.ARGON2_PARALLELISM,
    hashLength: AUTH_CONSTANTS.ARGON2_HASH_LENGTH,
    version: AUTH_CONSTANTS.ARGON2_VERSION,
  });
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    assertPasswordLength(password);

    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(AUTH_CONSTANTS.SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateCsrfToken(): string {
  return randomBytes(AUTH_CONSTANTS.CSRF_TOKEN_BYTES).toString("base64url");
}

export function hashCsrfToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
