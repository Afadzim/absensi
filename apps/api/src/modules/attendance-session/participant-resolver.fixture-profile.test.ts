import { describe, it } from "vitest";
import { testPrisma, closeTestDb } from "../../test/db.js";
import { createParticipantResolverFixture } from "../../test/fixtures/participant-resolver.fixture.js";

describe("Participant fixture profiling", () => {
  it(
    "profil createParticipantResolverFixture",
    async () => {
      const start = performance.now();

      const originalModels = [
        "institution",
        "academicYear",
        "semester",
        "schedulePeriod",
        "teacher",
        "class",
        "student",
        "studentClassEnrollment",
        "subject",
        "subjectOffering",
        "studentSubjectChoice",
        "schedule",
        "scheduleClassParticipant",
        "user",
      ] as const;

      const timings = new Map<string, number>();

      for (const model of originalModels) {
        const delegate = testPrisma[model] as any;

        if (!delegate?.create && !delegate?.createMany) {
          continue;
        }

        if (delegate.create) {
          const originalCreate = delegate.create.bind(delegate);

          delegate.create = async (...args: any[]) => {
            const t = performance.now();
            const result = await originalCreate(...args);
            const elapsed = performance.now() - t;
            timings.set(
              model,
              (timings.get(model) ?? 0) + elapsed,
            );
            return result;
          };
        }

        if (delegate.createMany) {
          const originalCreateMany = delegate.createMany.bind(delegate);

          delegate.createMany = async (...args: any[]) => {
            const t = performance.now();
            const result = await originalCreateMany(...args);
            const elapsed = performance.now() - t;
            timings.set(
              `${model}.createMany`,
              (timings.get(`${model}.createMany`) ?? 0) + elapsed,
            );
            return result;
          };
        }
      }

      await createParticipantResolverFixture();

      const total = performance.now() - start;

      console.log("");
      console.log("===== FIXTURE PROFILING =====");

      [...timings.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, ms]) => {
          console.log(
            `${name.padEnd(35)} ${ms.toFixed(0)} ms`,
          );
        });

      console.log("------------------------------");
      console.log(`TOTAL FIXTURE                    ${total.toFixed(0)} ms`);
      console.log("==============================");
      console.log("");

      await closeTestDb();
    },
    15000,
  );
});
