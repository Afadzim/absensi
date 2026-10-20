import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const previousCorsOrigins = process.env.CORS_ORIGINS;
const previousNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (previousCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = previousCorsOrigins;
  }

  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

describe("CORS configuration", () => {
  it("allows configured origins with browser credentials", async () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGINS = "https://portal.example.org";

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://portal.example.org",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://portal.example.org",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe(
      "true",
    );

    await app.close();
  });

  it("does not allow unconfigured origins", async () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGINS = "https://portal.example.org";

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://untrusted.example.org",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();

    await app.close();
  });

  it("requires an explicit origin allowlist in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;

    expect(() => buildApp()).toThrow(
      "CORS_ORIGINS must be configured in production.",
    );
  });

  it("rejects malformed configured origins", () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGINS = "https://portal.example.org/path";

    expect(() => buildApp()).toThrow(
      "Invalid CORS origin: https://portal.example.org/path",
    );
  });
});
