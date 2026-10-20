"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const CSRF_COOKIE_NAME = "__Host-am_csrf";

type Resource =
  | "institutions"
  | "academic-years"
  | "semesters"
  | "teachers"
  | "students"
  | "classes"
  | "student-enrollments"
  | "subjects"
  | "rooms"
  | "schedule-periods"
  | "subject-offerings"
  | "student-subject-choices"
  | "schedules"
  | "users";

type Field = {
  name: string;
  label: string;
  type?: "text" | "date" | "time" | "number" | "password" | "enum" | "reference" | "roles" | "multiselect";
  required?: boolean;
  nullable?: boolean;
  maxLength?: number;
  options?: readonly string[];
  reference?: Resource;
};

type ResourceConfig = {
  label: string;
  permissionKey: string;
  fields: readonly Field[];
  columns: readonly string[];
};

type UserSummary = {
  id: string;
  institutionId: string;
  username: string;
  teacherId: string | null;
  roles: string[];
  permissions: string[];
};

type Row = Record<string, unknown>;
type RoleOption = { id: string; name: string; description: string | null };
type FieldValues = Record<string, string | string[]>;

const resources: Record<Resource, ResourceConfig> = {
  institutions: {
    label: "Institusi",
    permissionKey: "institution",
    fields: [
      { name: "code", label: "Kode institusi", required: true, maxLength: 50 },
      { name: "name", label: "Nama institusi", required: true, maxLength: 200 },
    ],
    columns: ["code", "name"],
  },
  "academic-years": {
    label: "Tahun akademik",
    permissionKey: "academic-year",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 20 },
      { name: "name", label: "Nama", required: true, maxLength: 100 },
    ],
    columns: ["code", "name"],
  },
  semesters: {
    label: "Semester",
    permissionKey: "semester",
    fields: [
      { name: "academicYearId", label: "Tahun akademik", type: "reference", reference: "academic-years", required: true },
      { name: "code", label: "Kode", required: true, maxLength: 20 },
      { name: "name", label: "Nama", required: true, maxLength: 100 },
    ],
    columns: ["code", "name", "academicYearId"],
  },
  teachers: {
    label: "Guru",
    permissionKey: "teacher",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 50 },
      { name: "name", label: "Nama", required: true, maxLength: 200 },
      { name: "phone", label: "Telepon", nullable: true, maxLength: 30 },
    ],
    columns: ["code", "name", "phone", "userId"],
  },
  students: {
    label: "Siswa",
    permissionKey: "student",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 50 },
      { name: "name", label: "Nama", required: true, maxLength: 200 },
      { name: "nisn", label: "NISN", nullable: true, maxLength: 30 },
    ],
    columns: ["code", "name", "nisn"],
  },
  classes: {
    label: "Kelas",
    permissionKey: "class",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 50 },
      { name: "name", label: "Nama", required: true, maxLength: 100 },
      { name: "level", label: "Tingkat", nullable: true, maxLength: 30 },
    ],
    columns: ["code", "name", "level"],
  },
  "student-enrollments": {
    label: "Enrollment siswa",
    permissionKey: "student-enrollment",
    fields: [
      { name: "studentId", label: "Siswa", type: "reference", reference: "students", required: true },
      { name: "classId", label: "Kelas", type: "reference", reference: "classes", required: true },
      { name: "academicYearId", label: "Tahun akademik", type: "reference", reference: "academic-years", required: true },
      { name: "validFrom", label: "Berlaku mulai", type: "date", required: true },
      { name: "validTo", label: "Berlaku sampai (inklusif)", type: "date", nullable: true },
    ],
    columns: ["student", "class", "academicYear", "validFrom", "validTo"],
  },
  subjects: {
    label: "Mata pelajaran",
    permissionKey: "subject",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 50 },
      { name: "name", label: "Nama", required: true, maxLength: 150 },
    ],
    columns: ["code", "name"],
  },
  rooms: {
    label: "Ruang",
    permissionKey: "room",
    fields: [
      { name: "code", label: "Kode", required: true, maxLength: 50 },
      { name: "name", label: "Nama", required: true, maxLength: 100 },
    ],
    columns: ["code", "name"],
  },
  "schedule-periods": {
    label: "Periode jadwal",
    permissionKey: "schedule-period",
    fields: [
      { name: "periodNumber", label: "Nomor JP", type: "number", required: true },
      { name: "startTime", label: "Waktu mulai", type: "time", required: true },
      { name: "endTime", label: "Waktu selesai", type: "time", required: true },
    ],
    columns: ["periodNumber", "startTime", "endTime"],
  },
  "subject-offerings": {
    label: "Penawaran mata pelajaran",
    permissionKey: "subject-offering",
    fields: [
      { name: "academicYearId", label: "Tahun akademik", type: "reference", reference: "academic-years", required: true },
      { name: "subjectId", label: "Mata pelajaran", type: "reference", reference: "subjects", required: true },
      { name: "offeringType", label: "Jenis", type: "enum", required: true, options: ["REGULAR", "ELECTIVE"] },
      { name: "selectionStartLevel", label: "Tingkat awal pilihan", nullable: true, maxLength: 30 },
      { name: "continuationEndLevel", label: "Tingkat akhir lanjutan", nullable: true, maxLength: 30 },
    ],
    columns: ["academicYear", "subject", "offeringType", "selectionStartLevel", "continuationEndLevel"],
  },
  "student-subject-choices": {
    label: "Pilihan mata pelajaran siswa",
    permissionKey: "student-subject-choice",
    fields: [
      { name: "studentId", label: "Siswa", type: "reference", reference: "students", required: true },
      { name: "subjectOfferingId", label: "Penawaran mata pelajaran", type: "reference", reference: "subject-offerings", required: true },
      { name: "startLevel", label: "Tingkat mulai", required: true, maxLength: 30 },
      { name: "status", label: "Status", type: "enum", options: ["ACTIVE", "ENDED"] },
      { name: "effectiveFrom", label: "Berlaku mulai", type: "date", required: true },
      { name: "effectiveTo", label: "Berlaku sampai", type: "date", nullable: true },
      { name: "reason", label: "Keterangan", nullable: true, maxLength: 500 },
    ],
    columns: ["student", "subjectOffering", "startLevel", "status", "effectiveFrom", "effectiveTo"],
  },
  schedules: {
    label: "Jadwal",
    permissionKey: "schedule",
    fields: [
      { name: "academicYearId", label: "Tahun akademik", type: "reference", reference: "academic-years", required: true },
      { name: "semesterId", label: "Semester", type: "reference", reference: "semesters", required: true },
      { name: "dayOfWeek", label: "Hari ISO (Senin=1, Minggu=7)", type: "number", required: true },
      { name: "primaryTeacherId", label: "Guru utama", type: "reference", reference: "teachers", required: true },
      { name: "classId", label: "Kelas utama", type: "reference", reference: "classes", required: true },
      { name: "subjectId", label: "Mata pelajaran", type: "reference", reference: "subjects", required: true },
      { name: "subjectOfferingId", label: "Penawaran mata pelajaran (opsional)", type: "reference", reference: "subject-offerings", nullable: true },
      { name: "roomId", label: "Ruang (opsional)", type: "reference", reference: "rooms", nullable: true },
      { name: "startPeriodNumber", label: "JP mulai", type: "number", required: true },
      { name: "endPeriodNumber", label: "JP selesai (inklusif)", type: "number", required: true },
      { name: "classParticipantIds", label: "Kelas peserta tambahan", type: "multiselect", reference: "classes" },
    ],
    columns: ["dayOfWeek", "startPeriod.startTime", "endPeriod.endTime", "primaryTeacher.name", "class.name", "subject.name", "room.name", "studentParticipants"],
  },
  users: {
    label: "Akun pengguna",
    permissionKey: "user",
    fields: [
      { name: "username", label: "Username", required: true, maxLength: 100 },
      { name: "password", label: "Password (min. 15 karakter)", type: "password", required: true },
      { name: "status", label: "Status akun", type: "enum", options: ["ACTIVE", "INACTIVE"] },
      { name: "roleIds", label: "Role", type: "roles" },
      { name: "teacherId", label: "Tautan profil guru (opsional)", type: "reference", reference: "teachers", nullable: true },
    ],
    columns: ["username", "status", "teacher", "roles"],
  },
};

const resourceOrder = Object.keys(resources) as Resource[];

function permissionCode(
  resource: Resource,
  operation: "read" | "create" | "update",
): string {
  const prefix = resource === "schedules"
    ? "schedule"
    : `master_data.${resources[resource].permissionKey}`;
  return `${prefix}.${operation}`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method)) {
    if (!csrfToken && path !== "/api/v1/auth/login") {
      throw new Error("Token CSRF tidak tersedia. Muat ulang halaman atau login kembali.");
    }
    if (csrfToken) headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    const errorBody = payload as { error?: { message?: string } } | null;
    throw new Error(
      errorBody?.error?.message ?? `Permintaan gagal (${response.status}).`,
    );
  }

  return payload as T;
}

function readCookie(name: string): string | null {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getByPath(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Row)[key];
  }, row);
}

function objectRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Row =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
  );
}

function defaultValues(resource: Resource, row?: Row): FieldValues {
  const values: FieldValues = {};
  for (const field of resources[resource].fields) {
    if (field.name === "password") {
      values[field.name] = "";
      continue;
    }
    if (field.type === "roles") {
      const roles = row?.roles;
      values[field.name] = Array.isArray(roles)
        ? roles.flatMap((role) =>
            role !== null && typeof role === "object" && "id" in role
              ? [String(role.id)]
              : [],
          )
        : [];
      continue;
    }
    if (field.name === "classParticipantIds") {
      const participants = row?.classParticipants;
      const mainClassId = typeof row?.classId === "string" ? row.classId : null;
      values[field.name] = Array.isArray(participants)
        ? participants.flatMap((participant) => {
            if (
              participant !== null &&
              typeof participant === "object" &&
              "classId" in participant &&
              typeof participant.classId === "string" &&
              participant.classId !== mainClassId
            ) {
              return [participant.classId];
            }
            return [];
          })
        : [];
      continue;
    }
    const raw =
      resource === "users" && field.name === "teacherId"
        ? getByPath(row ?? {}, "teacher.id")
        : row?.[field.name];
    if (field.type === "date" && typeof raw === "string") {
      values[field.name] = raw.slice(0, 10);
    } else if (
      field.type === "time" &&
      typeof raw === "string"
    ) {
      values[field.name] = raw.slice(11, 16);
    } else {
      values[field.name] = raw === null || raw === undefined ? "" : String(raw);
    }
  }
  return values;
}

export default function MasterDataConsole() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Resource>("academic-years");
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [auditReason, setAuditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [referenceRows, setReferenceRows] = useState<
    Partial<Record<Resource, Row[]>>
  >({});
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [overrideScheduleId, setOverrideScheduleId] = useState<string | null>(null);
  const [overrideParticipantId, setOverrideParticipantId] = useState("");
  const [overrideStudentId, setOverrideStudentId] = useState("");
  const [overrideAction, setOverrideAction] = useState<"INCLUDE" | "EXCLUDE">("INCLUDE");
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState("");
  const [overrideEffectiveTo, setOverrideEffectiveTo] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  const permittedResources = useMemo(
    () =>
      resourceOrder.filter((resource) =>
        user?.permissions.includes(permissionCode(resource, "read")),
      ),
    [user],
  );
  const activeSelected = permittedResources.includes(selected)
    ? selected
    : permittedResources[0] ?? selected;
  const config = resources[activeSelected];
  const canCreate = user?.permissions.includes(permissionCode(activeSelected, "create")) ?? false;
  const canUpdate = user?.permissions.includes(permissionCode(activeSelected, "update")) ?? false;
  const canRead = user?.permissions.includes(permissionCode(activeSelected, "read")) ?? false;

  const fetchRows = useCallback(async () => {
    if (!user || !canRead) return null;
    return request<{
      data: Row[];
      pagination: { total: number };
    }>(
      `${activeSelected === "schedules" ? "/api/v1/schedules" : `/api/v1/master-data/${activeSelected}`}?page=${page}&pageSize=${pageSize}`,
    );
  }, [activeSelected, canRead, page, pageSize, user]);

  const loadRows = useCallback(async () => {
    try {
      const result = await fetchRows();
      if (result) {
        setRows(result.data);
        setTotal(result.pagination.total);
      }
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Gagal memuat data master.",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchRows]);

  useEffect(() => {
    const controller = new AbortController();
    async function restoreSession() {
      try {
        const result = await request<{ user: UserSummary }>(
          "/api/v1/auth/me",
          { signal: controller.signal },
        );
        setUser(result.user);
        setCsrfToken(readCookie(CSRF_COOKIE_NAME));
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }
        if (
          error instanceof Error &&
          !error.message.includes("Authentication required")
        ) {
          setPageError(error.message);
        }
      } finally {
        setLoading(false);
      }
    }
    void restoreSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!user || !canRead) return;
    let active = true;
    void fetchRows()
      .then((result) => {
        if (!active || !result) return;
        setRows(result.data);
        setTotal(result.pagination.total);
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(
            error instanceof Error
              ? error.message
              : "Gagal memuat data master.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canRead, fetchRows, user]);

  useEffect(() => {
    if (!user || !canCreate && !canUpdate) return;
    const references = [
      ...new Set(
        config.fields.flatMap((field) =>
          field.reference ? [field.reference] : [],
        ).concat(activeSelected === "schedules" ? ["students" as Resource] : []),
      ),
    ];
    const canReadReference = (resource: Resource) =>
      user.permissions.includes(
        permissionCode(resource, "read"),
      );
    const readable = references.filter(canReadReference);
    if (readable.length === 0) return;

    let active = true;
    Promise.all(
      readable.map(async (resource) => {
        const result = await request<{ data: Row[] }>(
          `/api/v1/master-data/${resource}?page=1&pageSize=100`,
        );
        return [resource, result.data] as const;
      }),
    )
      .then((results) => {
        if (!active) return;
        setReferenceRows((current) => ({
          ...current,
          ...Object.fromEntries(results),
        }));
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(
            error instanceof Error
              ? `Tidak dapat memuat data referensi: ${error.message}`
              : "Tidak dapat memuat data referensi.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [activeSelected, canCreate, canUpdate, config.fields, user]);

  useEffect(() => {
    if (
      !user ||
      !user.permissions.some((permission) =>
        [
          "master_data.user.read",
          "master_data.user.create",
          "master_data.user.update",
        ].includes(permission),
      )
    ) {
      return;
    }
    let active = true;
    request<{ data: RoleOption[] }>("/api/v1/master-data/lookups/roles")
      .then((result) => {
        if (active) setRoles(result.data);
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(
            error instanceof Error
              ? `Tidak dapat memuat role: ${error.message}`
              : "Tidak dapat memuat role.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const result = await request<{
        csrfToken: string;
      }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ institutionId, username, password }),
      });
      setCsrfToken(result.csrfToken);
      const current = await request<{ user: UserSummary }>("/api/v1/auth/me");
      setUser(current.user);
      setPassword("");
      setNotice("Berhasil masuk.");
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Login gagal.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setPageError("");
    try {
      await request("/api/v1/auth/logout", { method: "POST" }, csrfToken ?? undefined);
      setUser(null);
      setCsrfToken(null);
      setRows([]);
      setReferenceRows({});
      setRoles([]);
      setNotice("Anda telah keluar.");
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Logout gagal.",
      );
    }
  }

  function openCreateForm() {
    setEditingId(null);
    setValues(defaultValues(activeSelected));
    setAuditReason("");
    setFormOpen(true);
    setPageError("");
  }

  function openEditForm(row: Row) {
    const id = row.id;
    if (typeof id !== "string") return;
    setEditingId(id);
    setValues(defaultValues(activeSelected, row));
    setAuditReason("");
    setFormOpen(true);
    setPageError("");
  }

  function setFieldValue(name: string, value: string | string[]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setPageError("");
    setNotice("");

    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      const value = values[field.name];
      if (field.type === "password" && editingId && value === "") continue;
      if (field.type === "roles" || field.type === "multiselect") {
        payload[field.name] = Array.isArray(value) ? value : [];
        continue;
      }
      if (value === undefined || value === "") {
        if (field.nullable) payload[field.name] = null;
        else if (field.required && !editingId) {
          setPageError(`${field.label} wajib diisi.`);
          setSaving(false);
          return;
        }
        continue;
      }
      if (field.type === "number") {
        payload[field.name] = Number(value);
      } else {
        payload[field.name] = value;
      }
    }
    if (auditReason.trim()) payload.auditReason = auditReason.trim();

    try {
      await request(
        activeSelected === "schedules"
          ? editingId
            ? `/api/v1/schedules/${editingId}`
            : "/api/v1/schedules"
          : editingId
            ? `/api/v1/master-data/${activeSelected}/${editingId}`
            : `/api/v1/master-data/${activeSelected}`,
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
        csrfToken ?? undefined,
      );
      setFormOpen(false);
      setNotice(editingId ? "Data berhasil diperbarui." : "Data berhasil dibuat.");
      await loadRows();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Gagal menyimpan data.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitStudentOverride(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overrideScheduleId) return;
    setSavingOverride(true);
    setPageError("");
    try {
      const updating = overrideParticipantId !== "";
      await request(
        `/api/v1/schedules/${overrideScheduleId}/student-participants${updating ? `/${overrideParticipantId}` : ""}`,
        {
          method: updating ? "PATCH" : "POST",
          body: JSON.stringify({
            studentId: overrideStudentId,
            action: overrideAction,
            effectiveFrom: overrideEffectiveFrom,
            effectiveTo: overrideEffectiveTo || null,
            reason: overrideReason || null,
          }),
        },
        csrfToken ?? undefined,
      );
      setOverrideScheduleId(null);
      setOverrideStudentId("");
      setOverrideEffectiveFrom("");
      setOverrideEffectiveTo("");
      setOverrideReason("");
      setNotice(
        updating
          ? "Override peserta siswa berhasil diperbarui."
          : "Override peserta siswa berhasil dicatat.",
      );
      await loadRows();
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "Gagal menyimpan override peserta.",
      );
    } finally {
      setSavingOverride(false);
    }
  }

  if (loading && !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <p className="text-sm text-slate-600">Memeriksa sesi...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-5">
        <form
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
          onSubmit={handleLogin}
        >
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Sistem Absensi Madrasah
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">
            Masuk ke akun
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Gunakan ID institusi, username, dan password yang diberikan
            pengelola.
          </p>
          <label className="mt-6 block text-sm font-medium text-slate-700">
            ID institusi
            <input
              autoComplete="organization"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-sm"
              onChange={(event) => setInstitutionId(event.target.value)}
              required
              value={institutionId}
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Username
            <input
              autoComplete="username"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {loginError && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
              {loginError}
            </p>
          )}
          <button
            className="mt-6 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Administrasi madrasah
            </p>
            <h1 className="mt-1 text-xl font-semibold">Data Master</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-slate-500">{user.institutionId}</p>
            </div>
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
              onClick={() => void handleLogout()}
              type="button"
            >
              Keluar
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 lg:grid-cols-[230px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Master data
          </p>
          <nav className="grid grid-cols-2 gap-1 lg:grid-cols-1" aria-label="Jenis data master">
            {permittedResources.map((resource) => (
              <button
                className={`rounded-lg px-3 py-2.5 text-left text-sm ${
                  activeSelected === resource
                    ? "bg-emerald-50 font-semibold text-emerald-800"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                key={resource}
                onClick={() => {
                  setSelected(resource);
                  setPage(1);
                  setFormOpen(false);
                  setPageError("");
                }}
                type="button"
              >
                {resources[resource].label}
              </button>
            ))}
            {permittedResources.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-600">
                Akun ini belum memiliki permission baca data master.
              </p>
            )}
          </nav>
        </aside>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">{config.label}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {total.toLocaleString("id-ID")} data · perubahan dicatat dalam audit
              </p>
            </div>
            {canCreate && (
              <button
                className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
                onClick={openCreateForm}
                type="button"
              >
                Tambah data
              </button>
            )}
          </div>

          {(pageError || notice) && (
            <div className="space-y-2 px-5 pt-4">
              {pageError && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
                  {pageError}
                </p>
              )}
              {notice && (
                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
                  {notice}
                </p>
              )}
            </div>
          )}

          {formOpen && (
            <form
              className="m-5 grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 sm:grid-cols-2"
              onSubmit={submitForm}
            >
              <div className="sm:col-span-2">
                <h3 className="font-semibold">
                  {editingId ? "Ubah data" : "Tambah data"} · {config.label}
                </h3>
              </div>
              {config.fields.map((field) => {
                const current = values[field.name];
                const inputValue = typeof current === "string" ? current : "";
                const inputClass =
                  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
                return (
                  <label
                    className="block text-sm font-medium text-slate-700"
                    key={field.name}
                  >
                    {field.label}
                    {field.type === "enum" ? (
                      <select
                        className={inputClass}
                        onChange={(event) => setFieldValue(field.name, event.target.value)}
                        required={field.required && !editingId}
                        value={inputValue}
                      >
                        <option value="">Pilih...</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === "reference" ? (
                      <div>
                        <input
                          className={`${inputClass} font-mono`}
                          list={`lookup-${activeSelected}-${field.name}`}
                          onChange={(event) => setFieldValue(field.name, event.target.value)}
                          placeholder="Pilih atau masukkan UUID"
                          required={field.required && !editingId}
                          value={inputValue}
                        />
                        <datalist id={`lookup-${activeSelected}-${field.name}`}>
                          {(referenceRows[field.reference ?? "students"] ?? []).map((row) => {
                            const id = typeof row.id === "string" ? row.id : "";
                            const label =
                              typeof row.name === "string"
                                ? `${row.code ?? ""} — ${row.name}`
                                : String(row.code ?? id);
                            return <option key={id} label={label} value={id} />;
                          })}
                        </datalist>
                      </div>
                    ) : field.type === "roles" ? (
                      <fieldset className="mt-2 space-y-2 rounded-lg border border-slate-300 bg-white p-3">
                        {roles.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Belum ada role yang tersedia. Role dikelola pemilik.
                          </p>
                        ) : (
                          roles.map((role) => {
                            const selectedRoles = Array.isArray(current) ? current : [];
                            return (
                              <label className="flex items-center gap-2 text-sm font-normal" key={role.id}>
                                <input
                                  checked={selectedRoles.includes(role.id)}
                                  onChange={(event) =>
                                    setFieldValue(
                                      field.name,
                                      event.target.checked
                                        ? [...selectedRoles, role.id]
                                        : selectedRoles.filter((id) => id !== role.id),
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>{role.name}</span>
                              </label>
                            );
                          })
                        )}
                      </fieldset>
                    ) : field.type === "multiselect" ? (
                      <select
                        className={`${inputClass} min-h-28`}
                        multiple
                        onChange={(event) =>
                          setFieldValue(
                            field.name,
                            Array.from(event.currentTarget.selectedOptions)
                              .map((option) => option.value)
                              .filter((id) => id !== values.classId),
                          )
                        }
                        value={
                          Array.isArray(current)
                            ? current.filter((id) => id !== values.classId)
                            : []
                        }
                      >
                        {(referenceRows[field.reference ?? "classes"] ?? [])
                          .filter((row) => row.id !== values.classId)
                          .map((row) => (
                            <option key={String(row.id)} value={String(row.id)}>
                              {String(row.code ?? "")} — {String(row.name ?? "")}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <input
                        className={inputClass}
                        maxLength={field.maxLength}
                        min={field.type === "number" ? 1 : undefined}
                        onChange={(event) => setFieldValue(field.name, event.target.value)}
                        required={field.required && !editingId && !(field.type === "password" && editingId)}
                        type={field.type ?? "text"}
                        value={inputValue}
                      />
                    )}
                    {field.type === "password" && editingId && (
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Kosongkan untuk mempertahankan password saat ini.
                      </span>
                    )}
                  </label>
                );
              })}
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Alasan perubahan (opsional)
                <input
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  maxLength={2000}
                  onChange={(event) => setAuditReason(event.target.value)}
                  value={auditReason}
                />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button
                  className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium"
                  onClick={() => setFormOpen(false)}
                  type="button"
                >
                  Batal
                </button>
              </div>
            </form>
          )}

          {overrideScheduleId && activeSelected === "schedules" && (
            <form
              className="mx-5 mb-5 grid gap-4 rounded-xl border border-amber-200 bg-amber-50/50 p-5 sm:grid-cols-2"
              onSubmit={submitStudentOverride}
            >
              <div className="sm:col-span-2">
                <h3 className="font-semibold">Penyesuaian peserta siswa</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Perubahan berlaku inklusif sesuai tanggal; catatan lama tetap diaudit.
                </p>
              </div>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Ubah override yang sudah ada (opsional)
                <select
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => {
                    const id = event.target.value;
                    setOverrideParticipantId(id);
                    const selectedOverride = objectRows(
                      rows.find((row) => row.id === overrideScheduleId)
                        ?.studentParticipants,
                    ).find((item) => item.id === id);
                    if (!selectedOverride) {
                      setOverrideStudentId("");
                      setOverrideAction("INCLUDE");
                      setOverrideEffectiveFrom("");
                      setOverrideEffectiveTo("");
                      setOverrideReason("");
                      return;
                    }
                    const student = selectedOverride.student;
                    if (
                      student !== null &&
                      typeof student === "object" &&
                      "id" in student &&
                      typeof student.id === "string"
                    ) {
                      setOverrideStudentId(student.id);
                    }
                    if (
                      selectedOverride.action === "INCLUDE" ||
                      selectedOverride.action === "EXCLUDE"
                    ) {
                      setOverrideAction(selectedOverride.action);
                    }
                    if (typeof selectedOverride.effectiveFrom === "string") {
                      setOverrideEffectiveFrom(
                        selectedOverride.effectiveFrom.slice(0, 10),
                      );
                    }
                    setOverrideEffectiveTo(
                      typeof selectedOverride.effectiveTo === "string"
                        ? selectedOverride.effectiveTo.slice(0, 10)
                        : "",
                    );
                    setOverrideReason(
                      typeof selectedOverride.reason === "string"
                        ? selectedOverride.reason
                        : "",
                    );
                  }}
                  value={overrideParticipantId}
                >
                  <option value="">Buat override baru</option>
                  {objectRows(
                    rows.find((row) => row.id === overrideScheduleId)
                      ?.studentParticipants,
                  ).map((item) => {
                    const id = typeof item.id === "string" ? item.id : "";
                    const student = item.student;
                    const studentLabel =
                      student !== null &&
                      typeof student === "object" &&
                      "name" in student
                        ? String(student.name)
                        : id;
                    return (
                      <option key={id} value={id}>
                        {studentLabel} · {String(item.action ?? "")} · {String(item.effectiveFrom ?? "").slice(0, 10)}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Siswa
                <select
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setOverrideStudentId(event.target.value)}
                  required
                  value={overrideStudentId}
                >
                  <option value="">Pilih siswa...</option>
                  {(referenceRows.students ?? []).map((student) => (
                    <option key={String(student.id)} value={String(student.id)}>
                      {String(student.code ?? "")} — {String(student.name ?? "")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Tindakan
                <select
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setOverrideAction(event.target.value as "INCLUDE" | "EXCLUDE")
                  }
                  value={overrideAction}
                >
                  <option value="INCLUDE">Sertakan</option>
                  <option value="EXCLUDE">Kecualikan</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Berlaku mulai
                <input
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setOverrideEffectiveFrom(event.target.value)}
                  required
                  type="date"
                  value={overrideEffectiveFrom}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Berlaku sampai (opsional, inklusif)
                <input
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setOverrideEffectiveTo(event.target.value)}
                  type="date"
                  value={overrideEffectiveTo}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Alasan
                <input
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  maxLength={500}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  value={overrideReason}
                />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button
                  className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={savingOverride}
                  type="submit"
                >
                  {savingOverride ? "Menyimpan..." : "Simpan override"}
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium"
                  onClick={() => setOverrideScheduleId(null)}
                  type="button"
                >
                  Batal
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {config.columns.map((column) => (
                    <th className="px-5 py-3 font-semibold" key={column}>
                      {column.replaceAll(".", " ")}
                    </th>
                  ))}
                  <th className="px-5 py-3 font-semibold">ID</th>
                  {(canUpdate || canCreate) && <th className="px-5 py-3 font-semibold">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td className="px-5 py-8 text-slate-500" colSpan={config.columns.length + 2}>Memuat data...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td className="px-5 py-8 text-slate-500" colSpan={config.columns.length + 2}>Belum ada data pada halaman ini.</td></tr>
                ) : (
                  rows.map((row, index) => (
                    <tr className="hover:bg-slate-50" key={String(row.id ?? index)}>
                      {config.columns.map((column) => (
                        <td className="max-w-[260px] truncate px-5 py-3 text-slate-700" key={column}>
                          {displayValue(getByPath(row, column))}
                        </td>
                      ))}
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">
                        {String(row.id ?? "—")}
                      </td>
                      {(canUpdate || canCreate) && (
                        <td className="px-5 py-3">
                          {canUpdate && (
                            <button
                              className="font-medium text-emerald-800 hover:underline"
                              onClick={() => openEditForm(row)}
                              type="button"
                            >
                              Ubah
                            </button>
                          )}
                          {activeSelected === "schedules" && canCreate && (
                            <button
                              className="ml-3 font-medium text-amber-800 hover:underline"
                              onClick={() => {
                                setOverrideScheduleId(String(row.id));
                                setOverrideParticipantId("");
                                setOverrideStudentId("");
                                setOverrideAction("INCLUDE");
                                setOverrideEffectiveFrom("");
                                setOverrideEffectiveTo("");
                                setOverrideReason("");
                              }}
                              type="button"
                            >
                              Override siswa
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
            <span>
              Halaman {page} · {total.toLocaleString("id-ID")} data
            </span>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Sebelumnya
              </button>
              <button
                className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                disabled={page * pageSize >= total || loading}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
