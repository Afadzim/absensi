# AGENTS.md
# MASTER DEVELOPMENT CONTRACT
## Sistem Absensi Madrasah Berbasis PWA

Dokumen ini adalah instruksi permanen untuk AI coding agent di repository ini.

## 1. Hierarki sumber kebenaran
Prioritas requirement:
1. BLUEPRINT-FINAL.md
2. BUSINESS-RULES.md
3. DATABASE-RULES.md
4. TEST-SCENARIOS.md
5. API/arsitektur yang telah disetujui
6. Implementasi kode
7. Asumsi teknis

Kode tidak boleh mengalahkan business rule.

## 2. Aturan kerja
Sebelum coding:
- inspeksi repository;
- baca seluruh contract files;
- pahami scope fase;
- identifikasi dependency dan risiko;
- jangan menebak requirement.

Jika requirement bertentangan atau belum jelas:
- JANGAN memilih sendiri;
- laporkan `REQUIREMENT CONFLICT` atau `REQUIREMENT GAP`;
- jelaskan dampaknya;
- tunggu keputusan.

## 3. Pengembangan bertahap
Urutan fase:
PHASE 0 Project Foundation
PHASE 1 Database Foundation
PHASE 2 Authentication + RBAC
PHASE 3 Master Data
PHASE 4 Schedule Engine
PHASE 5 Attendance Engine
PHASE 6 Substitution + Handover
PHASE 7 PWA + Offline Sync
PHASE 8 Dashboard + Reports
PHASE 9 Notifications
PHASE 10 Security + QA + Production

Jangan melompati fase tanpa instruksi eksplisit.

## 4. Workflow setiap fase
PLAN → IMPLEMENT → TEST → AUDIT → FIX → VERIFY → DOCUMENT.

Setelah fase selesai, berhenti dan laporkan:
- status;
- files changed;
- database changes;
- business rules implemented;
- tests created/passed;
- known issues;
- risks;
- next recommended phase.

## 5. Larangan
Jangan:
- mengubah business rules;
- membuat fitur bisnis baru tanpa persetujuan;
- menjadikan frontend sumber kebenaran;
- membuat student gate check-in otomatis menjadi seluruh JP;
- membuat ALPA siswa tanpa valid learning session;
- menganggap scan QR otomatis mengangkat guru pengganti;
- mengizinkan dua OPEN session segment bersamaan;
- mereset presensi siswa saat handover;
- menghitung session segment sebagai JP terpisah;
- menghapus historical record;
- menghapus audit trail;
- mengandalkan validasi frontend untuk keamanan;
- membuat duplicate transaction saat retry/offline sync.

## 6. Prioritas teknis
Correctness > Data Integrity > Security > Testability > Maintainability > UX.

## 7. Tugas pertama
Mulai hanya dengan PHASE 0 — PROJECT FOUNDATION.
Jangan membuat business logic.
Lakukan audit environment dan laporkan hasilnya.
