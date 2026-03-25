"use client";
/**
 * /auth/callback — legacy redirect target
 *
 * The IMS OAuth flow now redirects back to window.location.pathname (the page
 * that initiated sign-in), so this route is no longer the OAuth landing point.
 * If someone hits it directly, just send them home.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIMSAuth } from "@/contexts/IMSAuthContext";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { isAuthenticated } = useIMSAuth();

  useEffect(() => {
    // Short wait to let imslib process any #access_token hash if present
    const timer = setTimeout(() => {
      router.replace("/");
    }, 1500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "#555",
      }}
    >
      <p>{isAuthenticated ? "Signed in — redirecting…" : "Redirecting…"}</p>
    </div>
  );
}
