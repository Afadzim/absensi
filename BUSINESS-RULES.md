# BUSINESS RULES
## Sistem Absensi Madrasah

Format ID rule wajib dipertahankan agar test dan kode dapat merujuk aturan secara jelas.

### BR-STUDENT-001 — Gate check-in bukan presensi JP
Gate check-in mencatat keberadaan di sekolah, bukan kehadiran seluruh JP.

### BR-STUDENT-002 — Roster siswa
Jika check-in valid: muncul dan dapat dicentang.
Jika Admin IZIN/SAKIT/PENUGASAN: muncul tetapi tidak dapat dicentang.
Jika belum check-in dan tidak ada status Admin: tidak muncul.

### BR-STUDENT-003 — Admin status + check-in
Check-in selama periode status Admin membuat effective status NORMAL untuk proses presensi. Record Admin tidak dihapus.

### BR-STUDENT-004 — Valid session
Presensi siswa hanya boleh diproses pada learning session yang valid.

### BR-STUDENT-005 — No session, no ALPA
Tidak ada valid learning session berarti tidak ada presensi siswa dan tidak ada ALPA siswa.

### BR-STUDENT-006 — ALPA
ALPA siswa hanya dibuat setelah valid session difinalisasi dan siswa yang wajib diproses tidak hadir serta tidak memiliki status administratif efektif.

### BR-STUDENT-007 — Handover
Pergantian guru tidak menghapus atau mereset student attendance.

### BR-STUDENT-008 — Learning unit
Beberapa session segment berurutan dalam satu JP tetap dihitung sebagai satu learning unit.

### BR-STUDENT-009 — Student percentage
(HADIR + PENUGASAN) /
(HADIR + PENUGASAN + IZIN + SAKIT + ALPA) × 100%.

### BR-TEACHER-001 — Primary priority
Guru yang tercantum di jadwal adalah guru utama dan diprioritaskan.

### BR-TEACHER-002 — Official substitution
Guru pengganti harus ditetapkan Admin. Scan QR tidak cukup.

### BR-TEACHER-003 — Teacher no news
Guru utama yang tidak ada kabar sampai sesi berakhir, tanpa status Admin dan tanpa pengganti, menjadi ALPA.

### BR-TEACHER-004 — Administrative absence
DINAS/IZIN/SAKIT tanpa pengganti tidak menghasilkan valid learning session.
Dengan pengganti menghasilkan valid learning session.

### BR-TEACHER-005 — Teacher percentage
(HADIR + DINAS) / TOTAL SESI JADWAL × 100%.

### BR-SESSION-001 — Single open segment
Tidak boleh ada dua OPEN session segment pada learning unit yang sama secara bersamaan.

### BR-SESSION-002 — Sequential handover
Session segment dapat ditutup lalu dilanjutkan segment berikutnya oleh guru yang sah.

### BR-DATA-001 — Historical integrity
Perubahan jadwal masa depan tidak boleh mengubah fakta historis.

### BR-DATA-002 — Auditability
Perubahan data penting harus dapat ditelusuri.

### BR-SYNC-001 — Idempotency
Pengiriman ulang event dengan client_event_id yang sama tidak boleh menghasilkan transaksi bisnis ganda.

### BR-SECURITY-001 — Server authoritative
Frontend tidak boleh menjadi sumber keputusan final untuk business rule atau authorization.

### BR-SECURITY-002 — Tenant isolation
Data antar institution tidak boleh saling terbaca atau termodifikasi.

Jika menemukan aturan yang belum tercakup, jangan membuat keputusan bisnis sendiri. Laporkan sebagai REQUIREMENT GAP.
