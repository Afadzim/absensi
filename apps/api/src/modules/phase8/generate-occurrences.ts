import { prisma } from "../../lib/prisma.js";
import { Phase8Service } from "./phase8.service.js";

async function main(): Promise<void> {
  const service = new Phase8Service();
  const institutions = await prisma.institution.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });

  let totalCalendarDays = 0;
  let totalOccurrences = 0;
  for (const institution of institutions) {
    const result = await service.generateOccurrences(institution.id);
    totalCalendarDays += result.calendarDays;
    totalOccurrences += result.occurrences;
  }
  console.info(
    JSON.stringify({
      status: "completed",
      institutions: institutions.length,
      calendarDays: totalCalendarDays,
      occurrences: totalOccurrences,
    }),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
