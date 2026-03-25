"use client";
/**
 * AuthButton — shows the current IMS auth state and sign-in/out controls.
 *
 * Reads from localStorage on mount and listens for the custom "ims-auth-change"
 * event so it stays in sync when the callback page writes tokens.
 */

import { useEffect, useState, useCallback } from "react";
import { loadAuthState, signIn, signOut, isAuthenticated, type IMSProfile } from "@/lib/ims";
import styles from "./AuthButton.module.css";

export function AuthButton() {
  const [profile, setProfile] = useState<IMSProfile | null>(null);
  const [authed, setAuthed] = useState(false);

  const sync = useCallback(() => {
    setAuthed(isAuthenticated());
    setProfile(loadAuthState()?.profile ?? null);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener("ims-auth-change", sync);
    return () => window.removeEventListener("ims-auth-change", sync);
  }, [sync]);

  if (authed && profile) {
    const initials = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .map((s) => s![0])
      .join("")
      .toUpperCase() || profile.email[0].toUpperCase();

    return (
      <div className={styles.wrapper}>
        <span className={styles.avatar} title={profile.email}>
          {initials}
        </span>
        <span className={styles.name}>{profile.first_name || profile.email.split("@")[0]}</span>
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
