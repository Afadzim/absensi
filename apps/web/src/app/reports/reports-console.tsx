"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const CSRF_COOKIE_NAME = "__Host-am_csrf";

interface UserSummary {
  permissions: string[];
}

interface CalendarDay {
  id: string;
  calendarDate: string;
  dayType: "EFFECTIVE" | "NATIONAL_HOLIDAY" | "SPECIAL_HOLIDAY";
  label: string | null;
  generationCompletedAt: string | null;
  _count: { occurrences: number };
}

interface StudentReportRow {
  className?: string;
  classCode?: string;
  subjectName?: string;
  subjectCode?: string;
  denominator: number;
  counts: Record<string, number>;
  percentage: number | null;
}

interface TeacherReportRow {
  teacherName: string;
  teacherCode: string;
  denominator: number;
  counts: Record<string, number>;
  percentage: number | null;
}

interface ReportData {
  period: { startDate: string; endDate: string; systemEffectiveDate: string };
  calendar: { configuredDays: number; effectiveDays: number; holidays: number };
  instruction: {
    effectiveOccurrences: number;
    elapsedOccurrences: number;
    upcomingOccurrences: number;
    finalizedOccurrences: number;
    openOccurrences: number;
    cancelledOccurrences: number;
    missedOccurrences: number;
  };
  studentByClass: StudentReportRow[];
  studentBySubject: StudentReportRow[];
  teacherByPrimary: TeacherReportRow[];
  substituteSummary: Array<{
    teacherId: string;
    teacherCode: string;
    teacherName: string;
    counts: Record<string, number>;
  }>;
}

interface ApiErrorBody {
  error?: { message?: string };
}

function csrfCookie(): string | null {
  const item = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
  return item
    ? decodeURIComponent(item.slice(CSRF_COOKIE_NAME.length + 1))
    : null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
    const token = csrfCookie();
    if (!token) throw new Error("Token CSRF tidak tersedia. Login kembali.");
    headers.set("x-csrf-token", token);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const body = payload as ApiErrorBody;
    throw new Error(body.error?.message ?? `Permintaan gagal (${response.status}).`);
  }
  return payload as T;
}

function dateQuery(startDate: string, endDate: string): string {
  return `startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(" · ") || "Belum ada data";
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export default function ReportsConsole() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [dayType, setDayType] = useState<CalendarDay["dayType"]>("EFFECTIVE");
  const [dayLabel, setDayLabel] = useState("");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canReadCalendar =
    user?.permissions.includes("academic_calendar.read") ?? false;
  const canCreateCalendar =
    user?.permissions.includes("academic_calendar.create") ?? false;
  const canUpdateCalendar =
    user?.permissions.includes("academic_calendar.update") ?? false;
  const canReadReport =
    user?.permissions.includes("attendance.report.read") ?? false;

  useEffect(() => {
    void request<{ user: UserSummary }>("/api/v1/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Gagal memuat akun.",
        );
      });
  }, []);

  const loadData = useCallback(async () => {
    if (!startDate || !endDate || (!canReadCalendar && !canReadReport)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const query = dateQuery(startDate, endDate);
      const [calendarResponse, reportResponse] = await Promise.all([
        canReadCalendar
          ? request<{ data: CalendarDay[] }>(`/api/v1/academic-calendar?${query}`)
          : Promise.resolve({ data: [] }),
        canReadReport
          ? request<{ data: ReportData }>(`/api/v1/attendance/reports?${query}`)
          : Promise.resolve(null),
      ]);
      setCalendarDays(calendarResponse.data);
      setReport(reportResponse?.data ?? null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Gagal memuat laporan.",
      );
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [canReadCalendar, canReadReport, endDate, startDate]);

  async function createCalendarDay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/v1/academic-calendar", {
        method: "POST",
        body: JSON.stringify({
          calendarDate: newDate,
          dayType,
          label: dayLabel || null,
        }),
      });
      setNotice("Tanggal kalender berhasil disimpan.");
      setNewDate("");
      setDayLabel("");
      await loadData();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Gagal menyimpan kalender.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateCalendarDay(
    event: React.FormEvent<HTMLFormElement>,
    day: CalendarDay,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextType = form.get("dayType");
    if (
      nextType !== "EFFECTIVE" &&
      nextType !== "NATIONAL_HOLIDAY" &&
      nextType !== "SPECIAL_HOLIDAY"
    ) {
      setError("Jenis hari tidak valid.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/v1/academic-calendar/${day.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          dayType: nextType,
          label: String(form.get("label") ?? "") || null,
          auditReason: String(form.get("auditReason") ?? "") || undefined,
        }),
      });
      setNotice("Tanggal kalender berhasil diperbarui.");
      await loadData();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Gagal memperbarui kalender.",
      );
    } finally {
      setBusy(false);
    }
  }

  const table = (
    title: string,
    rows: StudentReportRow[],
    nameKey: "className" | "subjectName",
    codeKey: "classCode" | "subjectCode",
  ) => (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b text-slate-600">
            <tr>
              <th className="py-2 pr-4">Nama</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2">Persentase</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className="border-b last:border-0"
                key={`${row[codeKey] ?? row[nameKey]}`}
              >
                <td className="py-3 pr-4">
                  <span className="font-medium">{row[nameKey] ?? "—"}</span>
                  <span className="ml-2 text-slate-500">{row[codeKey] ?? ""}</span>
                </td>
                <td className="py-3 pr-4">{formatCounts(row.counts)}</td>
                <td className="py-3 pr-4">{row.denominator}</td>
                <td className="py-3 font-semibold">{percentage(row.percentage)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="py-4 text-slate-500" colSpan={4}>
                  Belum ada presensi siswa final untuk periode ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-5 py-8">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-semibold text-emerald-800 underline" href="/">
          Kembali ke administrasi
        </Link>
        <Link
          className="text-sm font-semibold text-emerald-800 underline"
          href="/attendance"
        >
          Buka presensi
        </Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Phase 8 · Dashboard dan laporan
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">
          Kalender akademik & rekap presensi
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Kalender harus memiliki entri eksplisit untuk setiap tanggal. Laporan
          hanya memakai snapshot jadwal dan presensi final yang tersedia.
        </p>
      </header>

      {error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}{" "}
          {!user && (
            <Link className="font-semibold underline" href="/attendance">
              Buka presensi untuk login
            </Link>
          )}
        </div>
      )}
      {notice && (
        <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Rentang tanggal</h2>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm">
            Mulai
            <input
              className="rounded border border-slate-300 px-3 py-2"
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Sampai
            <input
              className="rounded border border-slate-300 px-3 py-2"
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          <button
            className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy || !startDate || !endDate}
            onClick={() => void loadData()}
            type="button"
          >
            {busy ? "Memuat..." : "Tampilkan"}
          </button>
        </div>
      </section>

      {canCreateCalendar && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Tambah tanggal kalender</h2>
          <form
            className="mt-4 flex flex-wrap items-end gap-4"
            onSubmit={(event) => void createCalendarDay(event)}
          >
            <label className="grid gap-1 text-sm">
              Tanggal
              <input
                className="rounded border border-slate-300 px-3 py-2"
                onChange={(event) => setNewDate(event.target.value)}
                required
                type="date"
                value={newDate}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Jenis hari
              <select
                className="rounded border border-slate-300 px-3 py-2"
                onChange={(event) =>
                  setDayType(event.target.value as CalendarDay["dayType"])
                }
                value={dayType}
              >
                <option value="EFFECTIVE">Hari efektif</option>
                <option value="NATIONAL_HOLIDAY">Libur nasional</option>
                <option value="SPECIAL_HOLIDAY">Libur khusus</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Keterangan
              <input
                className="rounded border border-slate-300 px-3 py-2"
                maxLength={200}
                onChange={(event) => setDayLabel(event.target.value)}
                value={dayLabel}
              />
            </label>
            <button
              className="rounded bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              disabled={busy || !newDate}
              type="submit"
            >
              Simpan tanggal
            </button>
          </form>
        </section>
      )}

      {canReadCalendar && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Entri kalender</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Tanggal</th>
                  <th className="py-2 pr-4">Jenis</th>
                  <th className="py-2 pr-4">Keterangan</th>
                  <th className="py-2">Generator</th>
                  {canUpdateCalendar && <th className="py-2">Perubahan</th>}
                </tr>
              </thead>
              <tbody>
                {calendarDays.map((day) => (
                  <tr className="border-b last:border-0" key={day.id}>
                    <td className="py-3 pr-4">{day.calendarDate.slice(0, 10)}</td>
                    <td className="py-3 pr-4">{day.dayType}</td>
                    <td className="py-3 pr-4">{day.label ?? "—"}</td>
                    <td className="py-3">
                      {day.generationCompletedAt
                        ? `${day._count.occurrences} occurrence`
                        : "Belum diproses"}
                    </td>
                    {canUpdateCalendar && (
                      <td className="py-3">
                        {day.generationCompletedAt ? (
                          <span className="text-slate-500">Dikunci</span>
                        ) : (
                          <form
                            className="flex min-w-[28rem] flex-wrap gap-2"
                            onSubmit={(event) =>
                              void updateCalendarDay(event, day)
                            }
                          >
                            <select
                              className="rounded border border-slate-300 px-2 py-1"
                              defaultValue={day.dayType}
                              name="dayType"
                            >
                              <option value="EFFECTIVE">Efektif</option>
                              <option value="NATIONAL_HOLIDAY">Libur nasional</option>
                              <option value="SPECIAL_HOLIDAY">Libur khusus</option>
                            </select>
                            <input
                              className="w-36 rounded border border-slate-300 px-2 py-1"
                              defaultValue={day.label ?? ""}
                              maxLength={200}
                              name="label"
                              placeholder="Keterangan"
                            />
                            <input
                              className="w-36 rounded border border-slate-300 px-2 py-1"
                              maxLength={2000}
                              name="auditReason"
                              placeholder="Alasan perubahan"
                            />
                            <button
                              className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-50"
                              disabled={busy}
                              type="submit"
                            >
                              Ubah
                            </button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {calendarDays.length === 0 && (
                  <tr>
                    <td
                      className="py-4 text-slate-500"
                      colSpan={canUpdateCalendar ? 5 : 4}
                    >
                      Belum ada data; masukkan rentang lalu pilih Tampilkan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Hari kalender", report.calendar.configuredDays],
              ["Occurrence efektif", report.instruction.effectiveOccurrences],
              ["Selesai / berlalu", report.instruction.elapsedOccurrences],
              ["Sesi final", report.instruction.finalizedOccurrences],
            ].map(([label, value]) => (
              <div
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                key={label}
              >
                <p className="text-sm text-slate-600">{label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
              </div>
            ))}
          </section>
          <p className="text-sm text-slate-600">
            Periode {report.period.startDate}–{report.period.endDate}; batas
            laporan resmi {report.period.systemEffectiveDate}. Hari efektif:
            {" "}{report.calendar.effectiveDays}; libur: {report.calendar.holidays};
            sesi terbuka: {report.instruction.openOccurrences}; dibatalkan:
            {" "}{report.instruction.cancelledOccurrences}; tanpa sesi final:
            {" "}{report.instruction.missedOccurrences}; belum berlangsung:
            {" "}{report.instruction.upcomingOccurrences}.
          </p>
          {table("Rekap siswa per kelas", report.studentByClass, "className", "classCode")}
          {table("Rekap siswa per mata pelajaran", report.studentBySubject, "subjectName", "subjectCode")}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Rekap guru utama</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">Guru</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Total jadwal berlalu</th>
                    <th className="py-2">Persentase</th>
                  </tr>
                </thead>
                <tbody>
                  {report.teacherByPrimary.map((teacher) => (
                    <tr className="border-b last:border-0" key={teacher.teacherCode}>
                      <td className="py-3 pr-4">
                        {teacher.teacherName} <span className="text-slate-500">{teacher.teacherCode}</span>
                      </td>
                      <td className="py-3 pr-4">{formatCounts(teacher.counts)}</td>
                      <td className="py-3 pr-4">{teacher.denominator}</td>
                      <td className="py-3 font-semibold">{percentage(teacher.percentage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Aktivitas guru pengganti</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {report.substituteSummary.map((teacher) => (
                <li key={teacher.teacherId}>
                  {teacher.teacherName} ({teacher.teacherCode}): {formatCounts(teacher.counts)}
                </li>
              ))}
              {report.substituteSummary.length === 0 && (
                <li className="text-slate-500">Tidak ada penugasan pengganti pada periode ini.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
