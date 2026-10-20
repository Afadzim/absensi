import type {
  OutboxEntry,
  OutboxPayload,
} from "./offline-store";

export interface OutboxRepository {
  listOutbox(scope: string): Promise<OutboxEntry[]>;
  updateOutboxEntry(
    sequence: number,
    update: { status: "pending" | "conflict"; error?: string },
  ): Promise<void>;
  removeOutboxEntry(sequence: number): Promise<void>;
}

export interface SyncContext {
  scope: string;
  institutionId: string;
  userId: string;
  teacherId: string | null;
  csrfToken: string;
  apiBaseUrl: string;
}

export interface SyncResult {
  acknowledged: number;
  conflicts: number;
  waiting: number;
}

export type Fetcher = typeof fetch;

function requestFor(payload: OutboxPayload): { path: string; body: object } {
  if (payload.type === "gate-check-in") {
    return {
      path: "/api/v1/gate-events/check-in",
      body: {
        studentId: payload.studentId,
        eventAt: payload.eventAt,
        clientEventId: payload.clientEventId,
        source: "PWA",
      },
    };
  }
  return {
    path: `/api/v1/attendance-sessions/${encodeURIComponent(payload.sessionId)}/student-attendance`,
    body: { studentId: payload.studentId },
  };
}

function requireSequence(entry: OutboxEntry): number {
  const sequence = entry.sequence;
  if (sequence === undefined || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Offline queue entry is missing its IndexedDB sequence.");
  }
  return sequence;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      body.error !== null &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    return `Server menolak antrean (${response.status}).`;
  }
  return `Server menolak antrean (${response.status}).`;
}

export async function syncOutbox(
  repository: OutboxRepository,
  context: SyncContext,
  fetcher: Fetcher = fetch,
): Promise<SyncResult> {
  const entries = await repository.listOutbox(context.scope);
  let acknowledged = 0;
  let conflicts = 0;
  let waiting = 0;

  for (const [index, entry] of entries.entries()) {
    const sequence = requireSequence(entry);
    if (entry.status === "conflict") {
      conflicts += 1;
      continue;
    }
    if (
      entry.scope !== context.scope ||
      entry.institutionId !== context.institutionId ||
      entry.userId !== context.userId ||
      (entry.payload.type === "student-present" &&
        entry.teacherId !== context.teacherId)
    ) {
      await repository.updateOutboxEntry(sequence, {
        status: "conflict",
        error: "Antrean dibuat oleh akun atau guru yang berbeda.",
      });
      conflicts += 1;
      continue;
    }

    const request = requestFor(entry.payload);
    let response: Response;
    try {
      response = await fetcher(`${context.apiBaseUrl}${request.path}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": context.csrfToken,
        },
        body: JSON.stringify(request.body),
      });
    } catch {
      waiting += entries
        .slice(index)
        .filter((item) => item.status === "pending").length;
      break;
    }

    if (response.ok) {
      await repository.removeOutboxEntry(sequence);
      acknowledged += 1;
      continue;
    }

    if (response.status === 401 || response.status === 429 || response.status >= 500) {
      waiting += entries
        .slice(index)
        .filter((item) => item.status === "pending").length;
      break;
    }

    await repository.updateOutboxEntry(sequence, {
      status: "conflict",
      error: await responseMessage(response),
    });
    conflicts += 1;
  }

  return { acknowledged, conflicts, waiting };
}
