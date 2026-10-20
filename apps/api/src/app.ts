import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { AttendanceSessionService } from "./modules/attendance-session/attendance-session.service.js";
import { registerAttendanceSessionRoutes } from "./modules/attendance-session/attendance-session.routes.js";
import { AuthSessionService } from "./modules/auth/auth.session.service.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";

export interface BuildAppOptions {
  attendanceSessionService?: AttendanceSessionService;
  authSessionService?: AuthSessionService;
}

function getAllowedOrigins(): ReadonlySet<string> {
  const configuredOrigins = process.env.CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins?.length) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CORS_ORIGINS must be configured in production.");
    }

    return new Set(["http://localhost:3000"]);
  }

  for (const origin of configuredOrigins) {
    const parsed = new URL(origin);

    if (
      parsed.origin !== origin ||
      !["http:", "https:"].includes(parsed.protocol)
    ) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }

  return new Set(configuredOrigins);
}

export function buildApp(
  options: BuildAppOptions = {},
) {
  const allowedOrigins = getAllowedOrigins();
  const app = Fastify({
    logger: true,
  });

  void app.register(cors, {
    origin(origin, callback) {
      callback(null, origin ? allowedOrigins.has(origin) : true);
    },
    credentials: true,
  });

  void app.register(cookie);

  const attendanceSessionService =
    options.attendanceSessionService ??
    new AttendanceSessionService();

  const authSessionService =
    options.authSessionService ??
    new AuthSessionService();

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "absensi-madrasah-api",
    };
  });

  void registerAuthRoutes(app, {
    authSessionService,
  });

  void registerAttendanceSessionRoutes(
    app,
    attendanceSessionService,
    authSessionService,
  );

  return app;
}
