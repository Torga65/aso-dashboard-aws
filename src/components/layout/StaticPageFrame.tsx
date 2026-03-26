"use client";
/**
 * StaticPageFrame
 *
 * Embeds a self-contained static HTML page in an iframe while keeping the
 * Next.js header and navigation visible.
 *
 * Before the iframe is rendered it writes the active IMS access token to
 * localStorage under the key `aso_ims_auth` — the same key that the static
 * pages' own ims-auth.js reads.  This means the static page finds a valid
 * token on load and skips its built-in "Sign in with Adobe" prompt entirely.
 */

import { useEffect, useState } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";

/** localStorage key used by the static pages' ims-auth.js */
const ASO_IMS_AUTH_KEY = "aso_ims_auth";

interface Props {
  src: string;
  title: string;
}

export default function StaticPageFrame({ src, title }: Props) {
  const { accessToken, profile } = useIMSAuth();
  // Gate iframe render until after the token has been written to localStorage,
  // so the static page's scripts always find it on their first read.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (accessToken) {
      try {
        localStorage.setItem(
          ASO_IMS_AUTH_KEY,
          JSON.stringify({
            accessToken,
            refreshToken: null,
            // Give it a 1-hour TTL; imslib keeps the underlying token fresh
            // automatically so we re-write on every mount anyway.
            expiresAt: Date.now() + 60 * 60 * 1000,
            profile: profile ?? null,
            imsOrgId: null,
          })
        );
      } catch {
        /* storage may be blocked in certain browser configs */
      }
    }
    setReady(true);
  }, [accessToken, profile]);

  if (!ready) return null;

  return (
    <iframe
      src={src}
      title={title}
      style={{
        display: "block",
        width: "100%",
        // Fill the remaining viewport below the fixed 64px navbar
        height: "calc(100vh - 64px)",
        border: "none",
      }}
    />
  );
}
