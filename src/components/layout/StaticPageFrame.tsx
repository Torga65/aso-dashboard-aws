"use client";
/**
 * StaticPageFrame
 *
 * Embeds a self-contained static HTML page in an iframe while keeping the
 * Next.js header visible.
 *
 * Auth bridge: the React app holds the real imslib instance (IMSAuthContext).
 * Rather than running imslib inside the iframe (which hits X-Frame-Options:DENY
 * on auth-stg1.services.adobe.com), this component posts the access token into
 * the iframe via postMessage whenever it changes.  The iframe's imslib-adapter.js
 * listens for these messages and exposes them through the same API surface.
 */

import { useRef, useEffect, useCallback } from "react";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import { useTheme } from "@/contexts/ThemeContext";

interface Props {
  src: string;
  title: string;
}

export default function StaticPageFrame({ src, title }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { accessToken, profile, isReady, signIn, signOut } = useIMSAuth();
  const { colorScheme, fontSize } = useTheme();

  const postToIframe = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  // Send token + profile whenever they change — only post when we have a real token
  useEffect(() => {
    if (!isReady) return;
    if (accessToken) {
      postToIframe({ type: "ims-token", token: accessToken, profile });
    } else {
      postToIframe({ type: "ims-signout" });
    }
  }, [isReady, accessToken, profile, postToIframe]);

  // Push theme into iframe whenever it changes
  useEffect(() => {
    postToIframe({ type: "theme", colorScheme, fontSize });
  }, [colorScheme, fontSize, postToIframe]);

  // Also send token + profile when the iframe finishes loading (it may load after token is set)
  const handleLoad = useCallback(() => {
    if (!isReady) return;
    if (accessToken) {
      postToIframe({ type: "ims-token", token: accessToken, profile });
    } else {
      postToIframe({ type: "ims-signout" });
    }
    postToIframe({ type: "theme", colorScheme, fontSize });
  }, [isReady, accessToken, profile, colorScheme, fontSize, postToIframe]);

  // Listen for sign-in / sign-out requests from the iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "ims-signin-required") signIn();
      if (event.data?.type === "ims-signout-required") signOut();
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [signIn, signOut]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      onLoad={handleLoad}
      style={{
        display: "block",
        width: "100%",
        height: "calc(100vh - 64px)",
        border: "none",
      }}
    />
  );
}
