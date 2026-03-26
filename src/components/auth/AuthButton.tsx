"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useIMSAuth } from "@/contexts/IMSAuthContext";
import styles from "./AuthButton.module.css";

declare global {
  interface Window {
    adobeIMS?: {
      signIn: () => void;
      signOut: () => void;
      isSignedInUser: () => boolean;
    };
  }
}

export function AuthButton() {
  const { isAuthenticated, profile, isManualToken, isReady } = useIMSAuth();

  // Auto sign-in when imslib is ready and the user is not signed in
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      window.adobeIMS?.signIn();
    }
  }, [isReady, isAuthenticated]);

  if (isAuthenticated) {
    const initials = profile
      ? ([profile.first_name, profile.last_name]
          .filter(Boolean)
          .map((s) => s![0])
          .join("")
          .toUpperCase() || profile.email?.[0]?.toUpperCase() || "?")
      : "T"; // manual token — no profile

    const displayName = profile
      ? (profile.first_name || profile.email?.split("@")[0] || "User")
      : "Dev Token";

    return (
      <div className={styles.wrapper}>
        <span
          className={styles.avatar}
          style={isManualToken ? { background: "#d97706" } : undefined}
          title={isManualToken ? "Using manual developer token" : profile?.email}
        >
          {initials}
        </span>
        <span className={styles.name}>{displayName}</span>
        <button className={styles.signOut} onClick={() => window.adobeIMS?.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={styles.signInWrapper}>
      <button className={styles.signIn} onClick={() => window.adobeIMS?.signIn()}>
        Sign in with Adobe
      </button>
      <Link href="/developer" className={styles.devLink}>
        Developer mode
      </Link>
    </div>
  );
}
