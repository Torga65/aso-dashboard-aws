"use client";

import { useIMSAuth } from "@/contexts/IMSAuthContext";
import styles from "./AuthButton.module.css";

export function AuthButton() {
  const { isAuthenticated, profile, isManualToken, signIn, signOut } = useIMSAuth();

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
        <button className={styles.signOut} onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button className={styles.signIn} onClick={signIn}>
      Sign in with Adobe
    </button>
  );
}
