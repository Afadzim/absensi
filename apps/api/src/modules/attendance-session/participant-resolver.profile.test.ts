import { describe, it } from "vitest";
import { ParticipantResolverService } from "./participant-resolver.service.js";
import {
  createParticipantResolverFixture,
  TEST_DATE,
} from "../../test/fixtures/participant-resolver.fixture.js";

describe("ParticipantResolver profiling", () => {
  it(
    "profil fixture vs resolver",
    async () => {
      const resolver = new ParticipantResolverService();

      const fixtureStart = performance.now();

      const fixture = await createParticipantResolverFixture();

      const fixtureEnd = performance.now();

      const resolveStart = performance.now();

      const result = await resolver.resolve({
        institutionId: fixture.institution.id,
        scheduleId: fixture.schedules.regular.id,
        sessionDate: TEST_DATE.toISOString().slice(0, 10),
      });

      const resolveEnd = performance.now();

      console.log("");
      console.log("===== PROFILING =====");
      console.log(
        `FIXTURE : ${(fixtureEnd - fixtureStart).toFixed(0)} ms`,
      );
      console.log(
        `RESOLVE : ${(resolveEnd - resolveStart).toFixed(0)} ms`,
      );
      console.log(
        `TOTAL   : ${(resolveEnd - fixtureStart).toFixed(0)} ms`,
      );
      console.log("=====================");
      console.log("");

      console.log(`RESULT  : ${result.length} peserta`);
    },
    15000,
  );
});
