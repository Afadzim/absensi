import type { AuthContext } from "./modules/auth/auth.context.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
