"use client";
/**
 * /auth/callback — IMS OAuth callback page
 *
 * IMS redirects here after the user authenticates.
 * This page exchanges the authorization code for tokens (via the server-side
 * /api/auth/exchange proxy) and stores them in localStorage, then redirects
 * back to the app.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeCode } from "@/lib/ims";
import { Suspense } from "react";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(`IMS returned an error: ${searchParams.get("error_description") || errorParam}`);
      return;
    }

    if (!code) {
      setError("No authorization code received from IMS.");
      return;
    }

    exchangeCode(code)
      .then(() => {
        // Redirect back to wherever the user was heading (or home)
        const returnTo = sessionStorage.getItem("ims_return_to") || "/";
        sessionStorage.removeItem("ims_return_to");
        router.replace(returnTo);
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, [router, searchParams]);

  if (error) {
    return (
      <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h2>Authentication failed</h2>
        <p style={{ color: "#c33" }}>{error}</p>
        <a href="/">Return home</a>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <p>Completing sign-in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading…</div>}>
      <CallbackContent />
    </Suspense>
  );
}
