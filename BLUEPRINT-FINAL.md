# BLUEPRINT FINAL v1.0
## SISTEM ABSENSI MADRASAH BERBASIS PWA

Status: FINAL / LOCKED
Institusi awal: MA Nasy'atul Muta'allimin
Lokasi: Gapura Timur, Gapura, Sumenep

## 1. Arsitektur
Frontend: Next.js/React + TypeScript + PWA
Backend: Node.js + TypeScript + REST API
Database: PostgreSQL
ORM: Prisma
Offline: IndexedDB + sync queue + idempotency
Version control: Git/GitHub

## 2. Prinsip inti
- Jadwal adalah sumber kebenaran pembelajaran.
- Gate check-in bukan presensi JP.
- Presensi siswa berbasis valid learning session.
- Tidak ada valid session = tidak ada presensi siswa dan tidak ada ALPA siswa.
- Guru utama diprioritaskan.
- Guru pengganti harus ditetapkan resmi.
- Satu learning unit/JP dapat memiliki beberapa session segment berurutan.
- Tidak boleh ada dua OPEN segment pada learning unit yang sama.
- Handover tidak mereset presensi siswa.
- Historical data harus tetap dapat diaudit.

## 3. Daftar presensi siswa
| Kondisi | Muncul | Bisa dicentang |
|---|---:|---:|
| Sudah check-in gerbang | Ya | Ya |
| Admin: IZIN | Ya | Tidak |
| Admin: SAKIT | Ya | Tidak |
| Admin: PENUGASAN | Ya | Tidak |
| Belum check-in + tidak ada status Admin | Tidak | Tidak |

Jika siswa memiliki status Admin lalu check-in selama periode berlaku, effective status menjadi NORMAL dan siswa dapat diproses. Record administrasi asli tetap disimpan.

## 4. Status siswa
- HADIR
- PENUGASAN
- IZIN
- SAKIT
- ALPA

PENUGASAN dianggap hadir untuk persentase.

## 5. Persentase siswa
(HADIR + PENUGASAN) /
(HADIR + PENUGASAN + IZIN + SAKIT + ALPA) × 100%

HADIR dan PENUGASAN masuk pembilang.
IZIN, SAKIT, ALPA masuk penyebut.

## 6. Status guru
- HADIR
- DINAS
- IZIN
- SAKIT
- ALPA

Jika guru tidak ada kabar sampai sesi berakhir dan tidak ada pengganti: ALPA.

## 7. Persentase guru
(HADIR + DINAS) / TOTAL SESI JADWAL × 100%

DINAS dihitung sebagai pemenuhan kehadiran guru, tetapi tetap dilaporkan terpisah dari mengajar.

## 8. Guru utama dan pengganti
Guru utama adalah guru pada jadwal dan selalu diprioritaskan.
Substitute hanya sah jika ditetapkan Admin.
Scan QR saja tidak otomatis membuat substitute.

## 9. Handover
Contoh:
Segment 1: Zainal SUBSTITUTE 07:00–07:30
Segment 2: Hasan PRIMARY 07:30–08:20

Aturan:
- hanya satu OPEN segment pada satu waktu;
- segment dapat berurutan;
- student attendance tidak reset;
- satu learning unit tetap dihitung satu kali.

## 10. Guru Dinas/Izin/Sakit
Tanpa pengganti: tidak ada valid session dan siswa tidak dipresensi.
Dengan pengganti: ada valid session; siswa diproses; guru utama tetap berstatus administrasi; guru pengganti mendapat kehadiran mengajar.

## 11. Rekap
Rekap siswa per kelas.
Rekap siswa per mata pelajaran.
Rekap guru.
Laporan pelaksanaan pembelajaran.
Semua berbasis data final, bukan gate event mentah.

## 12. Audit
Perubahan penting harus memiliki actor, timestamp, entity, action, before, after, reason/source bila relevan.

## 13. Offline
Gunakan IndexedDB, sync queue, client_event_id, server-side idempotency, dan server-authoritative conflict resolution.

## 14. Multi-institution
Arsitektur harus siap menggunakan institution_id untuk isolasi tenant.

## 15. Perubahan blueprint
Business rule dalam dokumen ini tidak boleh diubah oleh agent tanpa keputusan eksplisit pemilik proyek.
