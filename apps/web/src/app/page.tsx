import MasterDataConsole from "./master-data-console";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <nav className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-right">
        <Link
          className="text-sm font-semibold text-emerald-800 underline underline-offset-4"
          href="/attendance"
        >
          Buka Presensi Offline
        </Link>
        <Link
          className="ml-5 text-sm font-semibold text-emerald-800 underline underline-offset-4"
          href="/reports"
        >
          Kalender & Laporan
        </Link>
      </nav>
      <MasterDataConsole />
    </>
  );
}
