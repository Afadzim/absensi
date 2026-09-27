import Fastify from "fastify";
import cors from "@fastify/cors";
import { AttendanceSessionService } from "./modules/attendance-session/attendance-session.service.js";
import { registerAttendanceSessionRoutes } from "./modules/attendance-session/attendance-session.routes.js";

export interface BuildAppOptions {
  attendanceSessionService?: AttendanceSessionService;
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

  const attendanceSessionService =
    options.attendanceSessionService ??
    new AttendanceSessionService();

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "absensi-madrasah-api",
    };
  });

  void registerAttendanceSessionRoutes(
    app,
    attendanceSessionService,
  );

  return app;
}