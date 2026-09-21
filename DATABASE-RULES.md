# DATABASE RULES
## Sistem Absensi Madrasah

## 1. Database
Gunakan PostgreSQL + Prisma ORM + Prisma Migrations.

## 2. Entitas minimal
- Institution
- AcademicYear
- Semester
- User
- Role
- Permission
- UserRole
- Teacher
- Student
- Class
- Subject
- Room
- Schedule
- SchedulePeriod
- TeacherAdministrativeStatus
- StudentAdministrativeStatus
- TeacherSubstitution
- AttendanceSession
- AttendanceSessionSegment
- StudentAttendance
- GateEvent
- AttendanceAdjustment
- AuditLog
- NotificationLog
- SyncOperation / ProcessedEvent

## 3. Integritas
Gunakan:
- primary key;
- foreign key;
- unique constraints;
- index pada foreign key dan kolom pencarian penting;
- transaction untuk operasi kritis;
- check constraints bila sesuai;
- enum atau constrained values untuk status.

## 4. Historical data
Record presensi dan audit tidak boleh dihapus melalui operasi bisnis normal.
Perubahan korektif menggunakan adjustment/audit.

## 5. Attendance identity
Student attendance harus memiliki identitas yang mencegah duplicate untuk satu student + learning unit.
Session segment tidak boleh menjadi denominator terpisah.

## 6. Session integrity
Backend/database harus mencegah dua OPEN segments aktif pada learning unit yang sama.
Gunakan constraint/transaction/locking yang sesuai dengan kemampuan PostgreSQL.

## 7. Idempotency
Sync event memiliki client_event_id yang unik sesuai scope yang ditentukan.
Retry event yang sama harus aman.

## 8. Tenant isolation
Entitas tenant-aware harus memiliki institution_id atau relasi tenant yang jelas.
Query aplikasi wajib membatasi tenant.

## 9. Status administrasi
StudentAdministrativeStatus dan TeacherAdministrativeStatus harus menyimpan periode berlaku serta actor pembuat.
Jangan overwrite historical status tanpa audit.

## 10. Substitution
TeacherSubstitution menyimpan:
schedule_id/date, original_teacher_id, substitute_teacher_id, reason, approved_by, approved_at, status.

## 11. Session
AttendanceSession merepresentasikan learning unit/session.
AttendanceSessionSegment merepresentasikan pelaksana aktual dan interval waktu.
Jangan menyamakan segment dengan learning unit.

## 12. Migration policy
Semua perubahan schema melalui Prisma migration.
Jangan mengedit production schema secara manual sebagai jalan pintas.
Migration destructive memerlukan strategi data dan approval.

## 13. Indexing minimum
Rencanakan index untuk:
- institution_id;
- schedule/date;
- teacher/date;
- class/date;
- student/date;
- session status;
- client_event_id;
- audit entity/entity_id;
- administrative status date range sesuai pola query.

## 14. Tidak boleh
- hard-delete historical attendance;
- cascade delete yang menghapus audit/historical attendance secara tidak sengaja;
- menyimpan business rule hanya dalam database tanpa representasi yang dapat diuji di domain/service layer;
- membuat kolom bebas untuk status yang seharusnya terkontrol.
