"use client";

import { useEffect, useState } from "react";

export default function PwaRuntime() {
  const [registrationError, setRegistrationError] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error: unknown) => {
        setRegistrationError(
          error instanceof Error
            ? `Penyimpanan app offline gagal diaktifkan: ${error.message}`
            : "Penyimpanan app offline gagal diaktifkan.",
        );
      });
  }, []);

  if (!registrationError) return null;
  return (
    <p
      className="fixed bottom-3 left-3 right-3 z-50 rounded-lg bg-amber-100 p-3 text-sm text-amber-950 shadow"
      role="alert"
    >
      {registrationError}
    </p>
  );
}
