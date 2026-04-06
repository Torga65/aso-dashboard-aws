# Hreflang fix validation context

Use this when validating whether a **suggested fix** from AEM Sites Optimizer (SpaceCat) is correct for a **confirmed** hreflang issue.

## What to check

- **Missing x-default**: The suggested fix should add or correct an `hreflang="x-default"` link pointing to the intended fallback URL (usually the primary or default language version). The same URL must appear in the page’s set of alternate links.
- **Missing or wrong language tags**: The fix should add or correct `<link rel="alternate" hreflang="<code>" href="<url>" />` (or equivalent in HTTP Link headers) so that each language variant is listed with a valid language code and the correct URL.
- **Self-referencing**: Each language version should include a link to itself (self-referencing hreflang) with the same URL as the current page for that locale.
- **Reciprocity**: If page A links to page B as an alternate, page B should link back to page A for that language.

## Valid language codes

Use standard BCP 47 / ISO 639-1 codes (e.g. `en`, `es`, `x-default`). Region subtags are allowed (e.g. `en-US`, `pt-BR`).

## Output

For each suggestion, decide whether the **suggested fix** (the change SpaceCat recommends) is correct and sufficient to fix the issue. Reply with `fix_correct: true` or `fix_correct: false` and a brief `explanation`.
