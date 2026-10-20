import { describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./offline-store";
import { syncOutbox } from "./offline-sync";

class MemoryOutbox {
  constructor(public entries: OutboxEntry[]) {}

  async listOutbox(scope: string) {
    return this.entries
      .filter((entry) => entry.scope === scope)
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  }

  async updateOutboxEntry(
    sequence: number,
    update: { status: "pending" | "conflict"; error?: string },
  ) {
    this.entries = this.entries.map((entry) =>
      entry.sequence === sequence ? { ...entry, ...update } : entry,
    );
  }

  async removeOutboxEntry(sequence: number) {
    this.entries = this.entries.filter((entry) => entry.sequence !== sequence);
  }
}

function entry(
  sequence: number,
  payload: OutboxEntry["payload"],
): OutboxEntry {
  return {
    sequence,
    id: `event-${sequence}`,
    scope: "institution:user",
    institutionId: "institution",
    userId: "user",
    teacherId: "teacher",
    createdAt: sequence,
    payload,
    status: "pending",
  };
}

const context = {
  scope: "institution:user",
  institutionId: "institution",
  userId: "user",
  teacherId: "teacher",
  csrfToken: "csrf",
  apiBaseUrl: "https://api.example.test",
};

describe("offline attendance sync", () => {
  it("sends queued gate check-in before dependent attendance and removes acknowledged events", async () => {
    const repository = new MemoryOutbox([
      entry(1, {
        type: "gate-check-in",
        studentId: "student",
        eventAt: "2026-09-25T00:10:00.000Z",
        clientEventId: "stable-gate-id",
      }),
      entry(2, {
        type: "student-present",
        sessionId: "session",
        studentId: "student",
      }),
    ]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ duplicate: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "attendance" } }), { status: 200 }));

    const result = await syncOutbox(repository, context, fetcher);

    expect(result).toEqual({ acknowledged: 2, conflicts: 0, waiting: 0 });
    expect(repository.entries).toHaveLength(0);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/v1/gate-events/check-in",
      "https://api.example.test/api/v1/attendance-sessions/session/student-attendance",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      clientEventId: "stable-gate-id",
      studentId: "student",
    });
  });

  it("preserves a server-rejected event as a conflict without retrying it", async () => {
    const repository = new MemoryOutbox([
      entry(1, {
        type: "student-present",
        sessionId: "session",
        studentId: "student",
      }),
    ]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Session is finalized." } }), {
        status: 409,
      }),
    );

    const first = await syncOutbox(repository, context, fetcher);
    const second = await syncOutbox(repository, context, fetcher);

    expect(first).toEqual({ acknowledged: 0, conflicts: 1, waiting: 0 });
    expect(second).toEqual({ acknowledged: 0, conflicts: 1, waiting: 0 });
    expect(repository.entries[0]).toMatchObject({
      status: "conflict",
      error: "Session is finalized.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps pending events when authentication or the network is unavailable", async () => {
    const repository = new MemoryOutbox([
      entry(1, {
        type: "gate-check-in",
        studentId: "student",
        eventAt: "2026-09-25T00:10:00.000Z",
        clientEventId: "stable-gate-id",
      }),
    ]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const result = await syncOutbox(repository, context, fetcher);

    expect(result).toEqual({ acknowledged: 0, conflicts: 0, waiting: 1 });
    expect(repository.entries[0].status).toBe("pending");
  });

  it("never syncs a student attendance event under a different teacher identity", async () => {
    const repository = new MemoryOutbox([
      entry(1, {
        type: "student-present",
        sessionId: "session",
        studentId: "student",
      }),
    ]);
    const fetcher = vi.fn<typeof fetch>();

    const result = await syncOutbox(
      repository,
      { ...context, teacherId: "different-teacher" },
      fetcher,
    );

    expect(result).toEqual({ acknowledged: 0, conflicts: 1, waiting: 0 });
    expect(repository.entries[0].status).toBe("conflict");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
