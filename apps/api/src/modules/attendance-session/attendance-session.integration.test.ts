import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildApp } from "../../app.js";
import { testPrisma } from "../../test/db.js";
import {
  createAttendanceSessionFixture,
} from "./attendance-session.test.fixture.js";

const SESSION_DATE =
  "2026-09-25T00:00:00.000Z";

const OPEN_TIME =
  new Date("2026-09-25T07:10:00.000Z");

const FINALIZE_TIME =
  new Date("2026-09-25T07:30:00.000Z");

const CANCEL_TIME =
  new Date("2026-09-25T07:15:00.000Z");

const OTHER_INSTITUTION_ID =
  "99999999-9999-4999-8999-999999999999";

describe(
  "AttendanceSession HTTP integration",
  () => {
    let app: ReturnType<typeof buildApp>;
    let fixture: Awaited<
      ReturnType<
        typeof createAttendanceSessionFixture
      >
    >;

    beforeEach(async () => {
      vi.useFakeTimers({
        toFake: ["Date"],
      });

      vi.setSystemTime(OPEN_TIME);

      fixture =
        await createAttendanceSessionFixture();

      /*
       * Fixture membuat session untuk test service.
       * Untuk integration test POST /attendance-sessions,
       * session tersebut harus dihapus agar endpoint benar-benar
       * membuat AttendanceSession baru.
       */
      await testPrisma.attendanceSession.delete({
        where: {
          id_institutionId: {
            id: fixture.sessionId,
            institutionId: fixture.institutionId,
          },
        },
      });

      app = buildApp();
    });

    afterEach(async () => {
      await app.close();
      await fixture.cleanup();
      vi.useRealTimers();
    });

    it(
      "POST create benar-benar membuat AttendanceSession di PostgreSQL",
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/attendance-sessions",
          headers: {
            "x-institution-id":
              fixture.institutionId,
            "content-type":
              "application/json",
          },
          payload: {
            scheduleId: fixture.scheduleId,
            sessionDate: SESSION_DATE,
          },
        });

        expect(response.statusCode).toBe(201);

        const body = response.json();

        expect(body.data).toBeDefined();
        expect(body.data.id).toEqual(
          expect.any(String),
        );
        expect(body.data.status).toBe("OPEN");

        const persisted =
          await testPrisma.attendanceSession.findUnique(
            {
              where: {
                id_institutionId: {
                  id: body.data.id,
                  institutionId:
                    fixture.institutionId,
                },
              },
            },
          );

        expect(persisted).not.toBeNull();

        expect(persisted?.scheduleId).toBe(
          fixture.scheduleId,
        );

        expect(persisted?.sessionDate).toEqual(
          new Date(SESSION_DATE),
        );

        expect(persisted?.status).toBe("OPEN");

        expect(
          persisted?.primaryTeacherIdSnapshot,
        ).toBe(fixture.teacherId);

        expect(
          persisted?.classIdSnapshot,
        ).toBe(fixture.classId);

        expect(
          persisted?.subjectIdSnapshot,
        ).toBe(fixture.subjectId);

        expect(
          persisted?.startPeriodNumberSnapshot,
        ).toBe(fixture.startPeriodNumber);

        expect(
          persisted?.endPeriodNumberSnapshot,
        ).toBe(fixture.endPeriodNumber);
      },
    );

    it(
      "POST open menyimpan segment OPEN ke PostgreSQL",
      async () => {
        const createResponse =
          await app.inject({
            method: "POST",
            url: "/api/v1/attendance-sessions",
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "content-type":
                "application/json",
            },
            payload: {
              scheduleId: fixture.scheduleId,
              sessionDate: SESSION_DATE,
            },
          });

        expect(
          createResponse.statusCode,
        ).toBe(201);

        const sessionId =
          createResponse.json().data.id;

        vi.setSystemTime(OPEN_TIME);

        const openResponse =
          await app.inject({
            method: "POST",
            url:
              `/api/v1/attendance-sessions/${sessionId}/open`,
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "x-teacher-id":
                fixture.teacherId,
            },
          });

        expect(
          openResponse.statusCode,
        ).toBe(200);

        const segments =
          await testPrisma.attendanceSessionSegment.findMany(
            {
              where: {
                institutionId:
                  fixture.institutionId,
                attendanceSessionId:
                  sessionId,
              },
              orderBy: {
                startedAt: "asc",
              },
            },
          );

        expect(segments).toHaveLength(1);

        expect(segments[0].teacherId).toBe(
          fixture.teacherId,
        );

        expect(segments[0].status).toBe(
          "OPEN",
        );

        expect(
          segments[0].startedAt,
        ).toEqual(OPEN_TIME);

        expect(
          segments[0].endedAt,
        ).toBeNull();
      },
    );

    it(
      "POST finalize menutup session dan segment di PostgreSQL",
      async () => {
        const createResponse =
          await app.inject({
            method: "POST",
            url: "/api/v1/attendance-sessions",
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "content-type":
                "application/json",
            },
            payload: {
              scheduleId: fixture.scheduleId,
              sessionDate: SESSION_DATE,
            },
          });

        expect(
          createResponse.statusCode,
        ).toBe(201);

        const sessionId =
          createResponse.json().data.id;

        vi.setSystemTime(OPEN_TIME);

        const openResponse =
          await app.inject({
            method: "POST",
            url:
              `/api/v1/attendance-sessions/${sessionId}/open`,
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "x-teacher-id":
                fixture.teacherId,
            },
          });

        expect(
          openResponse.statusCode,
        ).toBe(200);

        vi.setSystemTime(FINALIZE_TIME);

        const finalizeResponse =
          await app.inject({
            method: "POST",
            url:
              `/api/v1/attendance-sessions/${sessionId}/finalize`,
            headers: {
              "x-institution-id":
                fixture.institutionId,
            },
          });

        expect(
          finalizeResponse.statusCode,
        ).toBe(200);

        expect(
          finalizeResponse.json().data.status,
        ).toBe("FINALIZED");

        const persisted =
          await testPrisma.attendanceSession.findUnique(
            {
              where: {
                id_institutionId: {
                  id: sessionId,
                  institutionId:
                    fixture.institutionId,
                },
              },
            },
          );

        expect(persisted).not.toBeNull();

        expect(persisted?.status).toBe(
          "FINALIZED",
        );

        const segments =
          await testPrisma.attendanceSessionSegment.findMany(
            {
              where: {
                institutionId:
                  fixture.institutionId,
                attendanceSessionId:
                  sessionId,
              },
              orderBy: {
                startedAt: "asc",
              },
            },
          );

        expect(segments).toHaveLength(1);

        expect(segments[0].status).toBe(
          "CLOSED",
        );

        expect(
          segments[0].startedAt,
        ).toEqual(OPEN_TIME);

        expect(
          segments[0].endedAt,
        ).toEqual(FINALIZE_TIME);
      },
    );

    it(
      "POST cancel menutup session dan tidak menyisakan segment OPEN",
      async () => {
        const createResponse =
          await app.inject({
            method: "POST",
            url: "/api/v1/attendance-sessions",
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "content-type":
                "application/json",
            },
            payload: {
              scheduleId: fixture.scheduleId,
              sessionDate: SESSION_DATE,
            },
          });

        expect(
          createResponse.statusCode,
        ).toBe(201);

        const sessionId =
          createResponse.json().data.id;

        vi.setSystemTime(OPEN_TIME);

        const openResponse =
          await app.inject({
            method: "POST",
            url:
              `/api/v1/attendance-sessions/${sessionId}/open`,
            headers: {
              "x-institution-id":
                fixture.institutionId,
              "x-teacher-id":
                fixture.teacherId,
            },
          });

        expect(
          openResponse.statusCode,
        ).toBe(200);

        vi.setSystemTime(CANCEL_TIME);

        const cancelResponse =
          await app.inject({
            method: "POST",
            url:
              `/api/v1/attendance-sessions/${sessionId}/cancel`,
            headers: {
              "x-institution-id":
                fixture.institutionId,
            },
          });

        expect(
          cancelResponse.statusCode,
        ).toBe(200);

        expect(
          cancelResponse.json().data.status,
        ).toBe("CANCELLED");

        const persisted =
          await testPrisma.attendanceSession.findUnique(
            {
              where: {
                id_institutionId: {
                  id: sessionId,
                  institutionId:
                    fixture.institutionId,
                },
              },
            },
          );

        expect(persisted).not.toBeNull();

        expect(persisted?.status).toBe(
          "CANCELLED",
        );

        const segments =
          await testPrisma.attendanceSessionSegment.findMany(
            {
              where: {
                institutionId:
                  fixture.institutionId,
                attendanceSessionId:
                  sessionId,
              },
            },
          );

        expect(segments).toHaveLength(1);

        expect(segments[0].status).toBe(
          "CLOSED",
        );
      },
    );

    it(
      "tenant isolation tetap ditegakkan melalui endpoint",
      async () => {
        const response =
          await app.inject({
            method: "POST",
            url: "/api/v1/attendance-sessions",
            headers: {
              "x-institution-id":
                OTHER_INSTITUTION_ID,
              "content-type":
                "application/json",
            },
            payload: {
              scheduleId:
                fixture.scheduleId,
              sessionDate: SESSION_DATE,
            },
          });

        expect(response.statusCode).toBe(
          404,
        );

        expect(
          response.json().error.code,
        ).toBe("NOT_FOUND");

        const sessions =
          await testPrisma.attendanceSession.findMany(
            {
              where: {
                scheduleId:
                  fixture.scheduleId,
              },
            },
          );

        expect(sessions).toHaveLength(0);
      },
    );
  },
);