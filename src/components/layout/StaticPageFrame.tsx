"use client";
/**
 * StaticPageFrame
 *
 * Embeds a self-contained static HTML page in an iframe while keeping the
 * Next.js header and navigation visible.
 *
 * The static pages now use imslib directly (loaded from CDN).  Since both
 * the React app and the static pages use imslib with the same client_id on
 * the same origin, they share imslib's localStorage session automatically —
 * no manual token bridge is required.
 */

interface Props {
  src: string;
  title: string;
}

export default function StaticPageFrame({ src, title }: Props) {
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
