export interface UserSummary {
  id: string;
  institutionId: string;
  username: string;
  teacherId: string | null;
  roles: string[];
  permissions: string[];
}

export interface AttendanceSessionSummary {
  id: string;
  scheduleId: string;
  sessionDate: string;
  status: "OPEN" | "FINALIZED" | "CANCELLED";
  primaryTeacherIdSnapshot: string;
  primaryTeacherNameSnapshot: string;
  classNameSnapshot: string;
  subjectNameSnapshot: string;
  startTimeSnapshot: string;
  endTimeSnapshot: string;
  scheduledJpSnapshot: string;
  openSegmentTeacherId: string | null;
}

export interface StudentRosterItem {
  studentId: string;
  studentCode: string;
  studentName: string;
  classId: string;
  classCode: string;
  className: string;
  gateCheckedIn: boolean;
  administrativeStatus: "IZIN" | "SAKIT" | "PENUGASAN" | null;
  administrativeStatusId: string | null;
  effectiveStatus: "NORMAL" | "IZIN" | "SAKIT" | "PENUGASAN";
  canCheck: boolean;
  attendanceStatus: string | null;
}

export interface CachedAttendanceSession {
  session: AttendanceSessionSummary;
  roster: StudentRosterItem[];
  cachedAt: number;
}

export interface CachedStudent {
  id: string;
  code: string;
  name: string;
}

export type OutboxPayload =
  | {
      type: "student-present";
      sessionId: string;
      studentId: string;
    }
  | {
      type: "gate-check-in";
      studentId: string;
      eventAt: string;
      clientEventId: string;
    };

export interface OutboxEntry {
  sequence?: number;
  id: string;
  scope: string;
  institutionId: string;
  userId: string;
  teacherId: string | null;
  createdAt: number;
  payload: OutboxPayload;
  status: "pending" | "conflict";
  error?: string;
}

interface ScopedRecord {
  key: string;
  scope: string;
}

interface ProfileRecord extends ScopedRecord {
  user: UserSummary;
  updatedAt: number;
}

interface SessionRecord extends ScopedRecord {
  sessionId: string;
  value: CachedAttendanceSession;
}

interface StudentRecord extends ScopedRecord {
  studentId: string;
  value: CachedStudent;
}

const DATABASE_NAME = "absensi-madrasah-offline";
const DATABASE_VERSION = 1;

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline storage is not supported in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const profiles = database.createObjectStore("profiles", { keyPath: "key" });
      profiles.createIndex("updatedAt", "updatedAt");
      const sessions = database.createObjectStore("sessions", { keyPath: "key" });
      sessions.createIndex("scope", "scope");
      const students = database.createObjectStore("students", { keyPath: "key" });
      students.createIndex("scope", "scope");
      const outbox = database.createObjectStore("outbox", {
        keyPath: "sequence",
        autoIncrement: true,
      });
      outbox.createIndex("scope", "scope");
      outbox.createIndex("dedupeKey", "dedupeKey");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open offline storage."));
    request.onblocked = () =>
      reject(new Error("Offline storage upgrade is blocked by another open tab."));
  });
}

export function offlineScope(user: Pick<UserSummary, "institutionId" | "id">): string {
  return `${user.institutionId}:${user.id}`;
}

function sessionKey(scope: string, sessionId: string): string {
  return `${scope}:session:${sessionId}`;
}

function studentKey(scope: string, studentId: string): string {
  return `${scope}:student:${studentId}`;
}

async function withStore<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeNames, mode);
    const complete = transactionComplete(transaction);
    const result = await action(transaction);
    await complete;
    return result;
  } finally {
    database.close();
  }
}

export async function saveProfile(user: UserSummary): Promise<void> {
  const scope = offlineScope(user);
  await withStore("profiles", "readwrite", async (transaction) => {
    await requestValue(
      transaction.objectStore("profiles").put({
        key: scope,
        scope,
        user,
        updatedAt: Date.now(),
      } satisfies ProfileRecord),
    );
  });
}

export async function getLatestProfile(): Promise<UserSummary | null> {
  return withStore("profiles", "readonly", async (transaction) => {
    const profiles = (await requestValue(
      transaction.objectStore("profiles").getAll(),
    )) as ProfileRecord[];
    profiles.sort((left, right) => right.updatedAt - left.updatedAt);
    return profiles[0]?.user ?? null;
  });
}

export async function saveCachedSession(
  user: UserSummary,
  value: CachedAttendanceSession,
): Promise<void> {
  const scope = offlineScope(user);
  await withStore("sessions", "readwrite", async (transaction) => {
    await requestValue(
      transaction.objectStore("sessions").put({
        key: sessionKey(scope, value.session.id),
        scope,
        sessionId: value.session.id,
        value,
      } satisfies SessionRecord),
    );
  });
}

export async function listCachedSessions(
  user: UserSummary,
): Promise<CachedAttendanceSession[]> {
  const scope = offlineScope(user);
  return withStore("sessions", "readonly", async (transaction) => {
    const records = (await requestValue(
      transaction.objectStore("sessions").index("scope").getAll(scope),
    )) as SessionRecord[];
    return records.map(({ value }) => value);
  });
}

export async function getCachedSession(
  user: UserSummary,
  sessionId: string,
): Promise<CachedAttendanceSession | null> {
  const scope = offlineScope(user);
  return withStore("sessions", "readonly", async (transaction) => {
    const record = (await requestValue(
      transaction.objectStore("sessions").get(sessionKey(scope, sessionId)),
    )) as SessionRecord | undefined;
    return record?.value ?? null;
  });
}

export async function replaceCachedStudents(
  user: UserSummary,
  students: CachedStudent[],
): Promise<void> {
  const scope = offlineScope(user);
  await withStore("students", "readwrite", async (transaction) => {
    const store = transaction.objectStore("students");
    await deleteScope(store.index("scope"), scope);
    await Promise.all(
      students.map((student) =>
        requestValue(
          store.put({
            key: studentKey(scope, student.id),
            scope,
            studentId: student.id,
            value: student,
          } satisfies StudentRecord),
        ),
      ),
    );
  });
}

export async function listCachedStudents(user: UserSummary): Promise<CachedStudent[]> {
  const scope = offlineScope(user);
  return withStore("students", "readonly", async (transaction) => {
    const records = (await requestValue(
      transaction.objectStore("students").index("scope").getAll(scope),
    )) as StudentRecord[];
    return records.map(({ value }) => value);
  });
}

function deleteScope(index: IDBIndex, scope: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(scope));
    request.onerror = () =>
      reject(request.error ?? new Error("Could not inspect cached offline data."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
}

export async function clearCachedUserData(user: UserSummary): Promise<void> {
  const scope = offlineScope(user);
  await withStore(["profiles", "sessions", "students"], "readwrite", async (transaction) => {
    await requestValue(transaction.objectStore("profiles").delete(scope));
    await deleteScope(transaction.objectStore("sessions").index("scope"), scope);
    await deleteScope(transaction.objectStore("students").index("scope"), scope);
  });
}

export async function enqueueOfflineEvent(
  user: UserSummary,
  teacherId: string | null,
  payload: OutboxPayload,
): Promise<OutboxEntry> {
  const scope = offlineScope(user);
  const dedupeKey =
    payload.type === "student-present"
      ? `${scope}:${payload.sessionId}:${payload.studentId}`
      : undefined;
  return withStore("outbox", "readwrite", async (transaction) => {
    const store = transaction.objectStore("outbox");
    if (dedupeKey) {
      const duplicate = (await requestValue(
        store.index("dedupeKey").get(dedupeKey),
      )) as OutboxEntry | undefined;
      if (duplicate) return duplicate;
    }
    const entry: OutboxEntry = {
      id: crypto.randomUUID(),
      scope,
      institutionId: user.institutionId,
      userId: user.id,
      teacherId,
      createdAt: Date.now(),
      payload,
      status: "pending",
    };
    const sequence = await requestValue(store.add({ ...entry, dedupeKey }));
    return { ...entry, sequence: Number(sequence) };
  });
}

export async function listOutbox(scope: string): Promise<OutboxEntry[]> {
  return withStore("outbox", "readonly", async (transaction) => {
    const entries = (await requestValue(
      transaction.objectStore("outbox").index("scope").getAll(scope),
    )) as OutboxEntry[];
    return entries.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  });
}

export async function updateOutboxEntry(
  sequence: number,
  update: Pick<OutboxEntry, "status"> & { error?: string },
): Promise<void> {
  await withStore("outbox", "readwrite", async (transaction) => {
    const store = transaction.objectStore("outbox");
    const current = (await requestValue(store.get(sequence))) as OutboxEntry | undefined;
    if (!current) return;
    await requestValue(
      store.put({
        ...current,
        status: update.status,
        ...(update.error ? { error: update.error } : { error: undefined }),
      }),
    );
  });
}

export async function removeOutboxEntry(sequence: number): Promise<void> {
  await withStore("outbox", "readwrite", async (transaction) => {
    await requestValue(transaction.objectStore("outbox").delete(sequence));
  });
}
