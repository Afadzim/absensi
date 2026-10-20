import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PwaRuntime from "./pwa-runtime";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sistem Absensi Madrasah",
  description: "Administrasi dan presensi madrasah dengan dukungan offline.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
