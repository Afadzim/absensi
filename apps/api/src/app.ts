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

export function buildApp(
  options: BuildAppOptions = {},
) {
  const app = Fastify({
    logger: true,
  });

  void app.register(cors, {
    origin: true,
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
  );

  return app;
}
