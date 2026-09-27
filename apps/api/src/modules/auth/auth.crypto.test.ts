import {
  describe,
  expect,
  it,
} from "vitest";

import {
  generateCsrfToken,
  generateSessionToken,
  hashCsrfToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./auth.crypto.js";

describe("Auth crypto primitives", () => {
  it("4A-001: password dapat di-hash", async () => {
    const password = "Password yang cukup panjang 123!";

    const hash = await hashPassword(password);

    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("4A-002: password benar dapat diverifikasi", async () => {
    const password = "Password yang cukup panjang 123!";
    const hash = await hashPassword(password);

    await expect(
      verifyPassword(password, hash),
    ).resolves.toBe(true);
  });

  it("4A-003: password salah ditolak", async () => {
    const password = "Password yang cukup panjang 123!";
    const wrongPassword = "Password lain yang juga panjang 123!";

    const hash = await hashPassword(password);

    await expect(
      verifyPassword(wrongPassword, hash),
    ).resolves.toBe(false);
  });

  it("4A-004: dua hash password yang sama tidak identik", async () => {
    const password = "Password yang cukup panjang 123!";

    const hashA = await hashPassword(password);
    const hashB = await hashPassword(password);

    expect(hashA).not.toBe(hashB);
  });

  it("4A-005: session token memiliki 256-bit entropy", () => {
    const token = generateSessionToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("4A-006: dua session token berbeda", () => {
    const tokenA = generateSessionToken();
    const tokenB = generateSessionToken();

    expect(tokenA).not.toBe(tokenB);
  });

  it("4A-007: hash session token deterministik", () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("4A-008: raw session token berbeda dari hash", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).not.toBe(token);
  });

  it("4A-009: CSRF token memiliki 256-bit entropy", () => {
    const token = generateCsrfToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("4A-010: hash CSRF token deterministik", () => {
    const token = generateCsrfToken();

    expect(hashCsrfToken(token)).toBe(hashCsrfToken(token));
  });

  it("4A-011: raw CSRF token berbeda dari hash", () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token);

    expect(hash).not.toBe(token);
  });

  it("4A-012: password kosong ditolak", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });

  it("4A-013: password panjang yang masih dalam batas dapat diproses", async () => {
    const password = "A".repeat(128);

    const hash = await hashPassword(password);

    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("4A-014: verifyPassword mengembalikan false untuk password invalid", async () => {
    const password = "Password yang cukup panjang 123!";
    const hash = await hashPassword(password);

    await expect(
      verifyPassword("pendek", hash),
    ).resolves.toBe(false);
  });
});
