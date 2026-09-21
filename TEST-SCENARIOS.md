# TEST SCENARIOS
## Acceptance Tests Sistem Absensi Madrasah

Semua business rule wajib memiliki test otomatis yang relevan.

## A. STUDENT ROSTER

### TC-STUDENT-001
Given: siswa memiliki gate check-in valid.
Expected:
- muncul di roster;
- can_check = true;
- effective status NORMAL.

### TC-STUDENT-002
Given: siswa belum check-in dan tidak memiliki status Admin.
Expected:
- tidak muncul di roster.

### TC-STUDENT-003
Given: siswa memiliki IZIN aktif tanpa check-in.
Expected:
- muncul;
- can_check = false;
- status IZIN.

### TC-STUDENT-004
Given: siswa memiliki SAKIT aktif tanpa check-in.
Expected:
- muncul;
- can_check = false;
- status SAKIT.

### TC-STUDENT-005
Given: siswa memiliki PENUGASAN aktif tanpa check-in.
Expected:
- muncul;
- can_check = false;
- status PENUGASAN.

### TC-STUDENT-006
Given: siswa memiliki IZIN aktif lalu melakukan gate check-in.
Expected:
- effective status NORMAL;
- dapat dicentang;
- record IZIN tetap ada.

## B. LEARNING SESSION

### TC-SESSION-001
Given: tidak ada valid learning session.
Expected:
- tidak ada student attendance;
- tidak ada student ALPA.

### TC-SESSION-002
Given: valid session telah difinalisasi dan siswa wajib diproses tetapi tidak hadir.
Expected:
- student attendance = ALPA.

### TC-SESSION-003
Given: satu learning unit memiliki dua segment berurutan.
Expected:
- denominator learning unit = 1;
- tidak ada double counting.

## C. TEACHER

### TC-TEACHER-001
Given: guru utama tersedia.
Expected:
- guru utama menjadi pelaksana.

### TC-TEACHER-002
Given: guru utama DINAS tanpa pengganti.
Expected:
- guru = DINAS;
- tidak ada valid learning session;
- siswa tidak dipresensi.

### TC-TEACHER-003
Given: guru utama DINAS dengan pengganti resmi.
Expected:
- guru utama = DINAS;
- substitute dapat membuka session;
- student attendance diproses.

### TC-TEACHER-004
Given: guru utama tidak ada kabar sampai sesi berakhir, tanpa pengganti.
Expected:
- guru utama = ALPA.

### TC-TEACHER-005
Given: guru utama tidak hadir lalu substitute resmi ditetapkan.
Expected:
- substitute dapat membuka session;
- primary tetap tercatat sebagai guru utama dengan status administratif/ketidakhadiran yang sesuai.

## D. HANDOVER

### TC-HANDOVER-001
Given:
- Zainal substitute membuka 07:00;
- Zainal menutup 07:30;
- Hasan primary membuka 07:30.
Expected:
- segment 1 = Zainal;
- segment 2 = Hasan;
- tidak ada dua OPEN segment;
- learning unit tetap satu.

### TC-HANDOVER-002
Given: siswa sudah HADIR pada segment Zainal.
Expected:
- presensi siswa tetap HADIR setelah Hasan mengambil alih.

### TC-HANDOVER-003
Given: dua user mencoba membuka segment secara bersamaan.
Expected:
- hanya satu yang berhasil;
- request lain ditolak/di-reconcile secara aman.

## E. PERCENTAGE

### TC-PERCENT-001
Input siswa:
HADIR=30, PENUGASAN=2, IZIN=3, SAKIT=1, ALPA=4.
Expected:
80%.

### TC-PERCENT-002
Input guru:
HADIR=34, DINAS=3, TOTAL JADWAL=40.
Expected:
92.5%.

### TC-PERCENT-003
Verify:
IZIN, SAKIT, ALPA tidak masuk pembilang siswa.
HADIR, PENUGASAN masuk pembilang siswa.

## F. OFFLINE / SYNC

### TC-SYNC-001
Given: event dibuat offline.
Expected:
- masuk IndexedDB queue;
- tidak hilang.

### TC-SYNC-002
Given: koneksi kembali.
Expected:
- queued event dikirim;
- server menerima dan memberi acknowledgement.

### TC-SYNC-003
Given: event dengan client_event_id sama dikirim berkali-kali.
Expected:
- satu business transaction;
- tidak ada duplicate attendance.

## G. SECURITY

### TC-SEC-001
User tanpa permission mencoba endpoint admin.
Expected: 403.

### TC-SEC-002
User dari institution A mencoba membaca data institution B.
Expected: ditolak / data tidak tersedia.

### TC-SEC-003
Client mengirim status attendance yang melanggar business rule.
Expected:
- server menolak;
- tidak cukup hanya mengandalkan validasi frontend.

## H. AUDIT

### TC-AUDIT-001
Admin mengubah status administratif.
Expected:
- perubahan tersimpan;
- audit record tercipta.

### TC-AUDIT-002
Attendance adjustment dilakukan.
Expected:
- adjustment tercatat;
- before/after tersedia;
- actor dan timestamp tersedia.

## I. QUALITY GATE
Fase tidak dianggap selesai jika:
- build/typecheck gagal;
- migration gagal;
- critical test gagal;
- business rule belum teruji;
- ada critical security issue;
- ada duplicate transaction yang belum terselesaikan.
