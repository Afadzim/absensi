import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL wajib di-set untuk test database.",
  );
}

if (!connectionString.includes("/absensi_madrasah_test")) {
  throw new Error(
    [
      "SAFETY STOP:",
      "Test database harus menggunakan database 'absensi_madrasah_test'.",
      "",
      `DATABASE_URL saat ini: ${connectionString}`,
      "",
      "Set terlebih dahulu:",
      '$env:DATABASE_URL = "postgresql://absensi:absensi_dev_password@localhost:5432/absensi_madrasah_test?schema=public"',
    ].join("\n"),
  );
}

const pool = new Pool({
  connectionString,
});

const adapter = new PrismaPg(pool);

export const testPrisma = new PrismaClient({
  adapter,
});

export async function closeTestDb(): Promise<void> {
  await testPrisma.$disconnect();
  await pool.end();
}
