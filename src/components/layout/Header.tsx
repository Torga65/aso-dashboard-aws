"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Header.module.css";
import { AuthButton } from "@/components/auth/AuthButton";

const NAV_LINKS = [
  { href: "/customer-history", label: "Customer 360" },
  { href: "/suggestion-lifecycle", label: "Suggestions Lifecycle" },
  { href: "/reports", label: "Reports" },
  { href: "/validator", label: "Validator" },
];

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

          {/* Auth */}
          <div className={styles.navAuth}>
            <AuthButton autoSignIn={pathname !== "/developer"} />
          </div>
        </nav>
      </div>
    </header>
  );
}
