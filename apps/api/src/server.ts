import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "absensi-madrasah-api",
  };
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({
    port,
    host,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
