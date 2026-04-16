"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Header.module.css";
import { AuthButton } from "@/components/auth/AuthButton";
import { useTheme, type ColorScheme, type FontSize } from "@/contexts/ThemeContext";

const NAV_LINKS = [
  { href: "/customer-history", label: "Customer 360" },
  { href: "/suggestion-lifecycle", label: "Suggestions Lifecycle" },
  { href: "/reports", label: "Reports" },
  { href: "/validator", label: "Validator" },
];

function SettingsPanel() {
  const { colorScheme, fontSize, setColorScheme, setFontSize } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className={styles.settingsWrapper} ref={ref}>
      <button
        className={styles.settingsButton}
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className={styles.settingsDropdown}>
          <div className={styles.settingsSection}>
            <span className={styles.settingsLabel}>Theme</span>
            <div className={styles.settingsToggleGroup}>
              {(['light', 'dark'] as ColorScheme[]).map((s) => (
                <button
                  key={s}
                  className={`${styles.settingsToggleBtn} ${colorScheme === s ? styles.settingsToggleActive : ''}`}
                  onClick={() => setColorScheme(s)}
                >
                  {s === 'light' ? '☀ Light' : '☾ Dark'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.settingsSection}>
            <span className={styles.settingsLabel}>Font Size</span>
            <div className={styles.settingsToggleGroup}>
              {(['small', 'medium', 'large'] as FontSize[]).map((s) => (
                <button
                  key={s}
                  className={`${styles.settingsToggleBtn} ${fontSize === s ? styles.settingsToggleActive : ''}`}
                  onClick={() => setFontSize(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  function close() {
    setIsOpen(false);
  }

  return (
    <header className={styles.header}>
      <div className={styles.navWrapper}>
        <nav
          className={styles.nav}
          aria-expanded={isOpen ? "true" : "false"}
          aria-label="Main navigation"
        >
          {/* Hamburger — mobile only */}
          <div className={styles.navHamburger}>
            <button
              aria-label={isOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setIsOpen((o) => !o)}
            >
              <span className={styles.navHamburgerIcon} aria-hidden="true" />
            </button>
          </div>

          {/* Brand */}
          <div className={styles.navBrand}>
            <Link href="/" onClick={close}>
              AEM Sites Optimizer
            </Link>
          </div>

          {/* Links */}
          <div className={styles.navSections}>
            <div className={styles.defaultContentWrapper}>
              <ul>
                {NAV_LINKS.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={close}
                      aria-current={pathname === href ? "page" : undefined}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Auth + Settings */}
          <div className={styles.navAuth}>
            <SettingsPanel />
            <AuthButton autoSignIn={pathname !== "/developer"} />
          </div>
        </nav>
      </div>
    </header>
  );
}
