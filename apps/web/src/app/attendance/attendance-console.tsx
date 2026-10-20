"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearCachedUserData,
  enqueueOfflineEvent,
  getCachedSession,
  getLatestProfile,
  listCachedSessions,
  listCachedStudents,
  listOutbox,
  offlineScope,
  removeOutboxEntry,
  replaceCachedStudents,
  saveCachedSession,
  saveProfile,
  updateOutboxEntry,
  type AttendanceSessionSummary,
  type CachedAttendanceSession,
  type CachedStudent,
  type OutboxEntry,
  type StudentRosterItem,
  type UserSummary,
} from "../../lib/offline-store";
import { syncOutbox } from "../../lib/offline-sync";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const ATTENDANCE_TIME_ZONE =
  process.env.NEXT_PUBLIC_ATTENDANCE_TIME_ZONE ?? "Asia/Jakarta";
const CSRF_COOKIE_NAME = "__Host-am_csrf";

interface ApiEnvelope<T> {
  data: T;
}

interface SessionListItem extends AttendanceSessionSummary {
  openSegmentTeacherId: string | null;
}

interface ScheduleItem {
  id: string;
  dayOfWeek: number;
  primaryTeacherId: string;
  primaryTeacher?: { name: string };
  class?: { name: string };
  subject?: { name: string };
  startPeriod?: { startTime: string };
  endPeriod?: { endTime: string };
}

interface StudentListItem {
  id: string;
  code: string;
  name: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
    if (!csrfToken) {
      throw new Error("Token CSRF tidak tersedia. Login online kembali.");
    }
    headers.set("x-csrf-token", csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    throw new NetworkError(
      error instanceof Error ? error.message : "Koneksi ke server gagal.",
    );
  }

  const payload: unknown =
    response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const body = payload as { error?: { message?: string } } | null;
    throw new ApiError(
      body?.error?.message ?? `Permintaan gagal (${response.status}).`,
      response.status,
    );
  }
  return payload as T;
}

function csrfCookie(): string | null {
  const item = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
  return item ? decodeURIComponent(item.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

function localDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format date in ${ATTENDANCE_TIME_ZONE}.`);
  }
  return `${year}-${month}-${day}`;
}

function isoWeekday(date: string): number {
  const dateAtNoonUtc = new Date(`${date}T12:00:00.000Z`);
  const day = dateAtNoonUtc.getUTCDay();
  return day === 0 ? 7 : day;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof NetworkError;
}

function permission(user: UserSummary | null, code: string): boolean {
  return user?.permissions.includes(code) ?? false;
}

function responseRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export default function AttendanceConsole() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [offlineProfile, setOfflineProfile] = useState(false);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [institutionId, setInstitutionId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [date, setDate] = useState("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [cachedSessions, setCachedSessions] = useState<CachedAttendanceSession[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [roster, setRoster] = useState<StudentRosterItem[]>([]);
  const [students, setStudents] = useState<CachedStudent[]>([]);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"attendance" | "gate">("attendance");
  const [studentSearch, setStudentSearch] = useState("");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [installed, setInstalled] = useState(false);
  const onlineDataRequestId = useRef(0);

  const activeSession =
    sessions.find((item) => item.id === activeSessionId) ??
    cachedSessions.find((item) => item.session.id === activeSessionId)?.session ??
    null;
  const scopedQueue = useMemo(
    () => queue.filter((item) => item.scope === (user ? offlineScope(user) : "")),
    [queue, user],
  );
  const pendingCount = scopedQueue.filter((item) => item.status === "pending").length;
  const conflictEntries = scopedQueue.filter((item) => item.status === "conflict");
  const displayedRoster = useMemo(() => {
    const sessionQueue = scopedQueue.filter(
      (entry) =>
        entry.status === "pending" &&
        entry.payload.type === "student-present" &&
        entry.payload.sessionId === activeSessionId,
    );
    const pendingGateStudents = new Set(
      scopedQueue.flatMap((entry) =>
        entry.payload.type === "gate-check-in" && entry.status === "pending"
          ? [entry.payload.studentId]
          : [],
      ),
    );
    const markedStudents = new Set(
      sessionQueue.flatMap((entry) =>
        entry.payload.type === "student-present" ? [entry.payload.studentId] : [],
      ),
    );
    return roster.map((student) => {
      const queuedCheckIn = pendingGateStudents.has(student.studentId);
      return {
        ...student,
        gateCheckedIn: student.gateCheckedIn || queuedCheckIn,
        canCheck:
          student.canCheck ||
          (queuedCheckIn &&
            activeSession?.status === "OPEN" &&
            activeSession.openSegmentTeacherId === user?.teacherId),
        attendanceStatus: markedStudents.has(student.studentId)
          ? "HADIR"
          : student.attendanceStatus,
      };
    });
  }, [activeSession, activeSessionId, roster, scopedQueue, user]);

  const reloadOutbox = useCallback(async (currentUser: UserSummary) => {
    const entries = await listOutbox(offlineScope(currentUser));
    setQueue(entries);
  }, []);

  const loadSessionRoster = useCallback(
    async (session: SessionListItem | AttendanceSessionSummary, currentUser: UserSummary) => {
      setActiveSessionId(session.id);
      if (navigator.onLine && !offlineProfile && permission(currentUser, "attendance.student.roster.read")) {
        try {
          const result = await request<ApiEnvelope<StudentRosterItem[]>>(
            `/api/v1/attendance-sessions/${session.id}/student-roster`,
          );
          const data = responseRows<StudentRosterItem>(result.data);
          setRoster(data);
          await saveCachedSession(currentUser, {
            session,
            roster: data,
            cachedAt: Date.now(),
          });
          return;
        } catch (error) {
          if (!isNetworkFailure(error)) {
            setPageError(
              error instanceof Error ? error.message : "Roster tidak dapat dimuat.",
            );
          }
        }
      }
      const cached = await getCachedSession(currentUser, session.id);
      if (!cached) {
        setRoster([]);
        setPageError(
          "Roster belum disimpan untuk offline. Muat roster saat online sebelum menandai presensi.",
        );
        return;
      }
      setRoster(cached.roster);
      setNotice(`Menggunakan roster tersimpan per ${new Date(cached.cachedAt).toLocaleString("id-ID")}.`);
    },
    [offlineProfile],
  );

  const refreshOnlineData = useCallback(async (
    currentUser: UserSummary | null,
    sessionDate: string,
    preferredSessionId: string,
  ) => {
    const requestId = ++onlineDataRequestId.current;
    if (!currentUser || !navigator.onLine) return;
    setPageError("");
    const results = await Promise.allSettled([
      permission(currentUser, "attendance.student.roster.read")
        ? request<ApiEnvelope<SessionListItem[]>>(
            `/api/v1/attendance-sessions?sessionDate=${encodeURIComponent(sessionDate)}`,
          )
        : Promise.resolve(null),
      permission(currentUser, "schedule.read")
        ? request<{
            data: ScheduleItem[];
            pagination: { total: number; pageSize: number };
          }>(
            `/api/v1/schedules?dayOfWeek=${isoWeekday(sessionDate)}&page=1&pageSize=100`,
          )
        : Promise.resolve(null),
    ]);
    if (requestId !== onlineDataRequestId.current) return;
    const sessionsResult = results[0];
    if (sessionsResult.status === "fulfilled" && sessionsResult.value) {
      const data = responseRows<SessionListItem>(sessionsResult.value.data);
      setSessions(data);
      const nextId =
        data.find((item) => item.id === preferredSessionId)?.id ??
        data.find((item) => item.status === "OPEN")?.id ??
        data[0]?.id ??
        "";
      setActiveSessionId(nextId);
      if (!nextId) setRoster([]);
      else {
        const current = data.find((item) => item.id === nextId);
        if (current) {
          try {
            const rosterResult = await request<ApiEnvelope<StudentRosterItem[]>>(
              `/api/v1/attendance-sessions/${current.id}/student-roster`,
            );
            const currentRoster = responseRows<StudentRosterItem>(rosterResult.data);
            if (requestId !== onlineDataRequestId.current) return;
            setRoster(currentRoster);
            await saveCachedSession(currentUser, {
              session: current,
              roster: currentRoster,
              cachedAt: Date.now(),
            });
          } catch (error) {
            if (isNetworkFailure(error)) {
              const cached = await getCachedSession(currentUser, current.id);
              if (requestId !== onlineDataRequestId.current) return;
              if (cached) setRoster(cached.roster);
            } else {
              if (requestId !== onlineDataRequestId.current) return;
              setPageError(
                error instanceof Error ? error.message : "Roster tidak dapat dimuat.",
              );
            }
          }
        }
      }
    } else if (sessionsResult.status === "rejected") {
      setPageError(
        sessionsResult.reason instanceof Error
          ? sessionsResult.reason.message
          : "Daftar sesi tidak dapat dimuat.",
      );
    }
    const schedulesResult = results[1];
    if (requestId !== onlineDataRequestId.current) return;
    if (schedulesResult.status === "fulfilled" && schedulesResult.value) {
      setSchedules(responseRows<ScheduleItem>(schedulesResult.value.data));
    } else if (schedulesResult.status === "rejected") {
      setPageError(
        schedulesResult.reason instanceof Error
          ? schedulesResult.reason.message
          : "Jadwal tidak dapat dimuat.",
      );
    }
  }, []);

  const syncForUser = useCallback(async (
    currentUser: UserSummary,
    currentCsrfToken: string | null,
    session: AttendanceSessionSummary | null,
  ) => {
    if (!currentCsrfToken || !navigator.onLine) {
      setNotice("Sync memerlukan koneksi dan sesi login online yang masih berlaku.");
      return;
    }
    setSyncing(true);
    setPageError("");
    try {
      const result = await syncOutbox(
        { listOutbox, updateOutboxEntry, removeOutboxEntry },
        {
          scope: offlineScope(currentUser),
          institutionId: currentUser.institutionId,
          userId: currentUser.id,
          teacherId: currentUser.teacherId,
          csrfToken: currentCsrfToken,
          apiBaseUrl: API_BASE_URL,
        },
      );
      await reloadOutbox(currentUser);
      if (result.acknowledged > 0) {
        setNotice(`${result.acknowledged} antrean telah diterima server.`);
      }
      if (result.conflicts > 0) {
        setNotice(
          `${result.conflicts} antrean ditolak server dan dipertahankan untuk tindak lanjut admin.`,
        );
      }
      if (result.acknowledged > 0 && session) {
        const rosterResult = await request<ApiEnvelope<StudentRosterItem[]>>(
          `/api/v1/attendance-sessions/${session.id}/student-roster`,
        );
        const currentRoster = responseRows<StudentRosterItem>(rosterResult.data);
        setRoster(currentRoster);
        await saveCachedSession(currentUser, {
          session,
          roster: currentRoster,
          cachedAt: Date.now(),
        });
      }
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Antrean tidak dapat disinkronkan.",
      );
    } finally {
      setSyncing(false);
    }
  }, [reloadOutbox]);

  const syncNow = useCallback(async () => {
    if (!user || offlineProfile) {
      setNotice("Sync memerlukan koneksi dan sesi login online yang masih berlaku.");
      return;
    }
    await syncForUser(user, csrfToken, activeSession);
  }, [activeSession, csrfToken, offlineProfile, syncForUser, user]);

  const revalidateOnlineSession = useCallback(async () => {
    try {
      const result = await request<{ user: UserSummary }>("/api/v1/auth/me");
      const token = csrfCookie();
      const today = localDate();
      setUser(result.user);
      setCsrfToken(token);
      setOfflineProfile(false);
      setOnline(true);
      setDate(today);
      await saveProfile(result.user);
      await refreshOnlineData(result.user, today, "");
      await syncForUser(result.user, token, activeSession);
    } catch (error) {
      if (isNetworkFailure(error)) {
        setOnline(false);
        setOfflineProfile(true);
      } else if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setCsrfToken(null);
        setOfflineProfile(false);
      } else {
        setPageError(
          error instanceof Error
            ? error.message
            : "Sesi online tidak dapat dipulihkan.",
        );
      }
    }
  }, [activeSession, refreshOnlineData, syncForUser]);

  useEffect(() => {
    const updateOnline = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void revalidateOnlineSession();
      else setOfflineProfile(true);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const install = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const installedHandler = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installedHandler);
    const installCheck = window.setTimeout(
      () => setInstalled(window.matchMedia("(display-mode: standalone)").matches),
      0,
    );
    return () => {
      window.clearTimeout(installCheck);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, [revalidateOnlineSession]);

  useEffect(() => {
    let mounted = true;
    async function restore() {
      try {
        const result = await request<{ user: UserSummary }>("/api/v1/auth/me");
        if (!mounted) return;
        const today = localDate();
        setUser(result.user);
        setCsrfToken(csrfCookie());
        setOfflineProfile(false);
        setOnline(true);
        setDate(today);
        await saveProfile(result.user);
        await refreshOnlineData(result.user, today, "");
        await syncForUser(result.user, csrfCookie(), null);
      } catch (error) {
        if (!mounted) return;
        setOnline(navigator.onLine);
        setDate(localDate());
        const canUseOfflineProfile =
          !navigator.onLine || isNetworkFailure(error);
        if (canUseOfflineProfile) {
          const cachedUser = await getLatestProfile();
          if (mounted && cachedUser) {
            setUser(cachedUser);
            setOfflineProfile(true);
          } else if (mounted) {
            setPageError(
              "Login online satu kali diperlukan sebelum data dapat disiapkan untuk offline.",
            );
          }
        } else if (!(error instanceof ApiError && error.status === 401)) {
          setPageError(error instanceof Error ? error.message : "Sesi tidak dapat dipulihkan.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void restore();
    return () => {
      mounted = false;
    };
  }, [refreshOnlineData, syncForUser]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    void Promise.all([
      listCachedSessions(user),
      listCachedStudents(user),
      listOutbox(offlineScope(user)),
    ])
      .then(([cached, cachedRoster, entries]) => {
        if (!mounted) return;
        setCachedSessions(cached);
        setStudents(cachedRoster);
        setQueue(entries);
        if (!online) {
          const cachedItems = cached.map((item) => item.session);
          setSessions(cachedItems);
          const first = cachedItems.find((item) => item.status === "OPEN") ?? cachedItems[0];
          if (first) {
            setActiveSessionId(first.id);
            setRoster(cached.find((item) => item.session.id === first.id)?.roster ?? []);
          }
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setPageError(
            error instanceof Error
              ? `Penyimpanan offline gagal dibaca: ${error.message}`
              : "Penyimpanan offline gagal dibaca.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [online, user]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError("");
    setLoading(true);
    try {
      const result = await request<{ csrfToken: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ institutionId, username, password }),
      });
      const current = await request<{ user: UserSummary }>("/api/v1/auth/me");
      setUser(current.user);
      setCsrfToken(result.csrfToken);
      setOfflineProfile(false);
      setPassword("");
      await saveProfile(current.user);
      setOnline(true);
      const today = localDate();
      setDate(today);
      await refreshOnlineData(current.user, today, activeSessionId);
      await syncForUser(current.user, result.csrfToken, activeSession);
      setNotice("Login berhasil. Muat sesi, roster, dan roster gerbang saat online sebelum digunakan offline.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Login gagal.");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (!user) return;
    if (online && csrfToken) {
      try {
        await request("/api/v1/auth/logout", { method: "POST" }, csrfToken);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Logout gagal.");
        return;
      }
    }
    try {
      await clearCachedUserData(user);
      setCachedSessions([]);
      setStudents([]);
      setSessions([]);
      setRoster([]);
      setUser(null);
      setCsrfToken(null);
      setOfflineProfile(false);
      setNotice("Data cache akun dihapus. Antrean lokal tetap tersimpan untuk tindak lanjut.");
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Cache akun tidak dapat dibersihkan: ${error.message}`
          : "Cache akun tidak dapat dibersihkan.",
      );
    }
  }

  async function selectSession(sessionId: string) {
    setPageError("");
    const session =
      sessions.find((item) => item.id === sessionId) ??
      cachedSessions.find((item) => item.session.id === sessionId)?.session;
    if (!session || !user) return;
    await loadSessionRoster(session, user);
  }

  async function changeDate(nextDate: string) {
    setDate(nextDate);
    if (user && online && !offlineProfile) {
      await refreshOnlineData(user, nextDate, activeSessionId);
    }
  }

  async function startSession(schedule: ScheduleItem) {
    if (!user || !csrfToken || !online || offlineProfile) return;
    setPageError("");
    setNotice("");
    try {
      let session = sessions.find((item) => item.scheduleId === schedule.id);
      if (!session) {
        try {
          await request(
            "/api/v1/attendance-sessions",
            {
              method: "POST",
              body: JSON.stringify({
                scheduleId: schedule.id,
                sessionDate: `${date}T00:00:00.000Z`,
              }),
            },
            csrfToken,
          );
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
        }
        const sessionsResult = await request<ApiEnvelope<SessionListItem[]>>(
          `/api/v1/attendance-sessions?sessionDate=${encodeURIComponent(date)}`,
        );
        const refreshed = responseRows<SessionListItem>(sessionsResult.data);
        setSessions(refreshed);
        session = refreshed.find((item) => item.scheduleId === schedule.id);
      }
      if (!session) throw new Error("Sesi jadwal tidak ditemukan setelah dibuat.");
      if (session.status !== "OPEN") {
        throw new Error("Sesi sudah ditutup dan tidak dapat dibuka kembali.");
      }
      if (!session.openSegmentTeacherId) {
        await request(
          `/api/v1/attendance-sessions/${session.id}/open`,
          { method: "POST" },
          csrfToken,
        );
      } else if (session.openSegmentTeacherId !== user.teacherId) {
        throw new Error("Segment aktif sedang dijalankan guru lain.");
      }
      const sessionsResult = await request<ApiEnvelope<SessionListItem[]>>(
        `/api/v1/attendance-sessions?sessionDate=${encodeURIComponent(date)}`,
      );
      const refreshed = responseRows<SessionListItem>(sessionsResult.data);
      setSessions(refreshed);
      const current = refreshed.find((item) => item.id === session?.id);
      if (!current) throw new Error("Sesi tidak tersedia setelah dibuka.");
      await loadSessionRoster(current, user);
      setNotice("Sesi dan roster siap. Cache offline hanya berlaku untuk akun ini.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Sesi tidak dapat dibuka.");
    }
  }

  async function markPresent(student: StudentRosterItem) {
    if (!user || !activeSession || !activeSessionId || !user.teacherId) return;
    if (
      activeSession.status !== "OPEN" ||
      activeSession.openSegmentTeacherId !== user.teacherId ||
      !student.canCheck
    ) {
      setPageError("Guru ini tidak berwenang menandai siswa pada segment aktif.");
      return;
    }
    setPageError("");
    try {
      await enqueueOfflineEvent(user, user.teacherId, {
        type: "student-present",
        sessionId: activeSessionId,
        studentId: student.studentId,
      });
      await reloadOutbox(user);
      setNotice("Tanda HADIR tersimpan lokal; belum resmi sampai server mengonfirmasi.");
      if (online && csrfToken && !offlineProfile) await syncNow();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Presensi tidak dapat disimpan lokal.",
      );
    }
  }

  async function loadGateRoster() {
    if (!user || !online || offlineProfile) return;
    setLoadingStudents(true);
    setPageError("");
    try {
      const first = await request<{
        data: StudentListItem[];
        pagination: { total: number; pageSize: number };
      }>("/api/v1/master-data/students?page=1&pageSize=100");
      const all = responseRows<StudentListItem>(first.data);
      const pages = Math.ceil(first.pagination.total / first.pagination.pageSize);
      for (let page = 2; page <= pages; page += 1) {
        const next = await request<{ data: StudentListItem[] }>(
          `/api/v1/master-data/students?page=${page}&pageSize=100`,
        );
        all.push(...responseRows<StudentListItem>(next.data));
      }
      const cached = all.map(({ id, code, name }) => ({ id, code, name }));
      await replaceCachedStudents(user, cached);
      setStudents(cached);
      setNotice(`${cached.length} data siswa disimpan lokal untuk check-in gerbang offline.`);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Roster gerbang tidak dapat dimuat.",
      );
    } finally {
      setLoadingStudents(false);
    }
  }

  async function gateCheckIn(student: CachedStudent) {
    if (!user) return;
    setPageError("");
    try {
      await enqueueOfflineEvent(user, null, {
        type: "gate-check-in",
        studentId: student.id,
        eventAt: new Date().toISOString(),
        clientEventId: crypto.randomUUID(),
      });
      await reloadOutbox(user);
      setNotice("Check-in gerbang tersimpan lokal; bukan presensi JP. Menunggu konfirmasi server.");
      if (online && csrfToken && !offlineProfile) await syncNow();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Check-in tidak dapat disimpan lokal.",
      );
    }
  }

  async function installApp() {
    if (!installPrompt || !("prompt" in installPrompt)) return;
    const prompt = installPrompt as Event & {
      prompt: () => Promise<void>;
    };
    await prompt.prompt();
    setInstallPrompt(null);
  }

  const gateStudents = students.filter((student) => {
    const query = studentSearch.trim().toLocaleLowerCase("id");
    return (
      query.length === 0 ||
      `${student.code} ${student.name}`.toLocaleLowerCase("id").includes(query)
    );
  });

  if (loading && !user) {
    return <main className="grid min-h-screen place-items-center p-6">Memeriksa sesi...</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-lg place-items-center p-5">
        <form className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={login}>
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800">
            Sistem Absensi Madrasah
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">Login untuk menyiapkan presensi offline</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Login memerlukan koneksi. Setelah itu, muat sesi dan roster sebelum masuk ke area tanpa internet.
          </p>
          <label className="mt-5 block text-sm font-medium">
            ID institusi
            <input className="mt-1 w-full rounded-lg border p-3" onChange={(event) => setInstitutionId(event.target.value)} required value={institutionId} />
          </label>
          <label className="mt-3 block text-sm font-medium">
            Username
            <input autoComplete="username" className="mt-1 w-full rounded-lg border p-3" onChange={(event) => setUsername(event.target.value)} required value={username} />
          </label>
          <label className="mt-3 block text-sm font-medium">
            Password
            <input autoComplete="current-password" className="mt-1 w-full rounded-lg border p-3" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {pageError && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950" role="alert">{pageError}</p>}
          <button className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60" disabled={!online || loading} type="submit">
            {online ? "Login" : "Menunggu koneksi"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl bg-slate-50 px-3 py-4 text-slate-900 sm:px-6 sm:py-8">
      <header className="rounded-2xl bg-emerald-900 p-4 text-white shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Sistem Absensi Madrasah</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Presensi lapangan</h1>
            <p className="mt-1 text-sm text-emerald-100">
              {user.username} {offlineProfile ? "· profil tersimpan offline" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {installPrompt && !installed && (
              <button className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900" onClick={() => void installApp()} type="button">
                Pasang aplikasi
              </button>
            )}
            <button className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold" onClick={() => void logout()} type="button">
              Keluar / hapus cache
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-3 py-1 font-semibold ${online ? "bg-emerald-100 text-emerald-950" : "bg-amber-200 text-amber-950"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">
            {pendingCount} antrean menunggu
          </span>
          <button className="rounded-lg bg-white px-3 py-1.5 font-semibold text-emerald-900 disabled:opacity-50" disabled={!online || syncing || offlineProfile || pendingCount === 0} onClick={() => void syncNow()} type="button">
            {syncing ? "Menyinkronkan..." : "Sinkronkan"}
          </button>
        </div>
      </header>

      <nav className="mt-4 flex gap-2" aria-label="Fitur presensi">
        <button aria-pressed={activeTab === "attendance"} className={`flex-1 rounded-xl px-3 py-3 text-sm font-semibold ${activeTab === "attendance" ? "bg-emerald-700 text-white" : "border bg-white"}`} onClick={() => setActiveTab("attendance")} type="button">
          Presensi JP
        </button>
        <button aria-pressed={activeTab === "gate"} className={`flex-1 rounded-xl px-3 py-3 text-sm font-semibold ${activeTab === "gate" ? "bg-emerald-700 text-white" : "border bg-white"}`} onClick={() => setActiveTab("gate")} type="button">
          Gate check-in
        </button>
      </nav>

      {pageError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">{pageError}</p>}
      {notice && <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" role="status">{notice}</p>}
      {offlineProfile && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
          Data yang dibuat offline bersifat sementara. Hak akses dan aturan akan divalidasi server saat sinkronisasi.
        </p>
      )}
      {(pendingCount > 0 || conflictEntries.length > 0) && (
        <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Status antrean offline">
          <h2 className="font-semibold">Antrean offline</h2>
          <p className="mt-1 text-sm">
            Tanda lokal belum menjadi presensi resmi sampai memperoleh acknowledgment server.
          </p>
          {conflictEntries.map((entry) => (
            <p className="mt-2 rounded-lg bg-red-100 p-2 text-sm text-red-950" key={entry.id} role="alert">
              Konflik tersimpan: {entry.error ?? "perlu tindak lanjut admin."} Data lokal tidak dihapus.
            </p>
          ))}
        </section>
      )}

      {activeTab === "attendance" ? (
        <section className="mt-4 space-y-4">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-semibold">
                Tanggal sesi
                <input className="mt-1 block rounded-lg border px-3 py-2" onChange={(event) => void changeDate(event.target.value)} type="date" value={date} />
              </label>
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!online || offlineProfile || !user} onClick={() => user && void refreshOnlineData(user, date, activeSessionId)} type="button">
                Muat ulang sesi
              </button>
            </div>
            {permission(user, "attendance.student.roster.read") ? (
              <label className="mt-4 block text-sm font-semibold">
                Sesi tersimpan
                <select className="mt-1 w-full rounded-lg border bg-white px-3 py-3" onChange={(event) => void selectSession(event.target.value)} value={activeSessionId}>
                  <option value="">Pilih sesi...</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.startTimeSnapshot.slice(11, 16)} · {session.classNameSnapshot} · {session.subjectNameSnapshot} · {session.status}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Akun tidak memiliki izin membaca roster presensi.</p>
            )}
            {activeSession && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-semibold">{activeSession.classNameSnapshot} · {activeSession.subjectNameSnapshot}</p>
                <p className="mt-1 text-slate-600">
                  Guru utama: {activeSession.primaryTeacherNameSnapshot} ·{" "}
                  {activeSession.openSegmentTeacherId === user.teacherId
                    ? "segment aktif milik akun ini"
                    : activeSession.openSegmentTeacherId
                      ? "segment aktif milik guru lain"
                      : "belum ada segment aktif"}
                </p>
              </div>
            )}
          </div>

          {online && !offlineProfile && schedules.length > 0 && (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="font-semibold">Jadwal hari ini</h2>
              <p className="mt-1 text-sm text-slate-600">Buat atau buka sesi hanya saat online. Setelah itu muat roster agar dapat dipakai offline.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {schedules.map((schedule) => (
                  <div className="flex items-center justify-between gap-3 rounded-xl border p-3" key={schedule.id}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{schedule.class?.name ?? "Kelas"} · {schedule.subject?.name ?? "Mata pelajaran"}</p>
                      <p className="text-sm text-slate-600">{schedule.startPeriod?.startTime.slice(11, 16)}–{schedule.endPeriod?.endTime.slice(11, 16)} · {schedule.primaryTeacher?.name}</p>
                    </div>
                    <button className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!user.teacherId || !permission(user, "attendance.session.create") || !permission(user, "attendance.session.open")} onClick={() => void startSession(schedule)} type="button">
                      Siapkan
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Roster siswa</h2>
                <p className="text-sm text-slate-600">Hanya siswa eligible dari server yang dapat ditandai HADIR.</p>
              </div>
              <span className="text-sm text-slate-500">{displayedRoster.length} siswa</span>
            </div>
            {displayedRoster.length === 0 ? (
              <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Pilih sesi online dan muat roster, atau gunakan roster sesi yang sudah disimpan sebelumnya.
              </p>
            ) : (
              <ul className="mt-3 divide-y">
                {displayedRoster.map((student) => {
                  const queueEntry = scopedQueue.find(
                    (entry) =>
                      entry.payload.type === "student-present" &&
                      entry.payload.sessionId === activeSessionId &&
                      entry.payload.studentId === student.studentId,
                  );
                  return (
                    <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={student.studentId}>
                      <div>
                        <p className="font-semibold">{student.studentName}</p>
                        <p className="text-sm text-slate-600">{student.studentCode} · {student.className}</p>
                        <p className="text-xs text-slate-500">
                          {student.administrativeStatus && !student.gateCheckedIn
                            ? `Status: ${student.administrativeStatus}`
                            : student.gateCheckedIn
                              ? "Gate check-in tercatat"
                              : "Belum check-in"}
                          {queueEntry?.status === "conflict" ? " · konflik sync" : queueEntry ? " · menunggu server" : ""}
                        </p>
                      </div>
                      <button
                        className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${student.attendanceStatus === "HADIR" ? "bg-emerald-100 text-emerald-900" : "bg-emerald-700 text-white disabled:bg-slate-200 disabled:text-slate-500"}`}
                        disabled={
                          student.attendanceStatus === "HADIR" ||
                          Boolean(queueEntry) ||
                          !student.canCheck ||
                          !activeSession ||
                          activeSession.openSegmentTeacherId !== user.teacherId
                        }
                        onClick={() => void markPresent(student)}
                        type="button"
                      >
                        {student.attendanceStatus === "HADIR"
                          ? queueEntry?.status === "pending"
                            ? "HADIR · lokal"
                            : "HADIR"
                          : queueEntry?.status === "conflict"
                            ? "Konflik sync"
                            : "Tandai hadir"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Check-in gerbang</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Check-in gerbang bukan presensi JP. Data siswa lokal hanya disimpan pada perangkat dan akun ini; sinkronkan sebelum presensi kelas.
              </p>
            </div>
            {permission(user, "master_data.student.read") && (
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!online || offlineProfile || loadingStudents} onClick={() => void loadGateRoster()} type="button">
                {loadingStudents ? "Memuat..." : "Muat roster gerbang"}
              </button>
            )}
          </div>
          {!permission(user, "attendance.gate.checkin") || !permission(user, "master_data.student.read") ? (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
              Gate check-in memerlukan permission attendance.gate.checkin dan master_data.student.read.
            </p>
          ) : (
            <>
              <label className="mt-4 block text-sm font-medium">
                Cari siswa
                <input className="mt-1 w-full rounded-lg border px-3 py-3" onChange={(event) => setStudentSearch(event.target.value)} placeholder="Cari nama atau kode" value={studentSearch} />
              </label>
              <p className="mt-2 text-xs text-slate-500">{students.length} siswa tersimpan di perangkat.</p>
              <ul className="mt-2 divide-y">
                {gateStudents.slice(0, 100).map((student) => (
                  <li className="flex items-center justify-between gap-3 py-3" key={student.id}>
                    <div>
                      <p className="font-semibold">{student.name}</p>
                      <p className="text-sm text-slate-600">{student.code}</p>
                    </div>
                    <button className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => void gateCheckIn(student)} type="button">
                      Check-in
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <footer className="mt-6 flex flex-wrap justify-between gap-3 text-sm text-slate-600">
        <Link className="font-semibold text-emerald-800 underline" href="/">Kembali ke administrasi</Link>
        <span>Finalisasi, handover, dan perubahan status administrasi memerlukan koneksi online.</span>
      </footer>
    </main>
  );
}
