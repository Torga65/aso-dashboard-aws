"use client";
/**
 * /auth/callback — Adobe IMS OAuth callback page
 *
 * IMS redirects here after sign-in with `#access_token=...` in the URL hash.
 * The @identity/imslib SDK (initialized in IMSAuthProvider) automatically
 * detects the hash on page load, validates the token, fires onAccessToken,
 * and clears the hash.
 *
 * This page just waits for the context to report isAuthenticated, then
 * redirects to wherever the user was heading.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIMSAuth } from "@/contexts/IMSAuthContext";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { isAuthenticated, isReady } = useIMSAuth();

  useEffect(() => {
    if (!isReady) return;

    if (isAuthenticated) {
      const returnTo =
        (typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem("ims_return_to")) ||
        "/";
      sessionStorage.removeItem("ims_return_to");
      router.replace(returnTo);
    }
    // If ready but not authenticated, the imslib may still be processing the
    // hash — give it a moment before showing an error.
  }, [isAuthenticated, isReady, router]);

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
      <p>Completing sign-in…</p>
    </div>
  );
}
