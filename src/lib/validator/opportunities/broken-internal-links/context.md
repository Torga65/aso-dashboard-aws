# Broken internal links / backlinks — validation

## Gate logic

The gate validator performs two checks:

1. **URL To is broken** — requests the broken link target (HEAD, then GET fallback) and expects a non-2xx response. If URL To responds with 2xx the issue is a false positive (the link is already working).

2. **Suggested replacement works** — if URL To is broken, the suggested replacement URL (from `urlsSuggested`, `urlSuggested`, `aiSuggestion`, `suggestionValue`, or similar fields) is fetched. A 2xx response confirms the fix is valid.

No URL From page fetching or Playwright is used — only direct HTTP checks against URL To and the suggested URL.

## Result mapping

| Gate result | Meaning |
|---|---|
| `gate_passed` | URL To is working (2xx) — not a broken link; treated as false positive |
| `real_issue` | URL To is broken (non-2xx); `fixValidated` indicates whether the suggested URL works |
| `could_not_validate` | URL To could not be reached (timeout, DNS, etc.) |
| `invalid_data` | Required fields missing or schema mismatch |

## Applies to

- `broken-internal-links` opportunity type
- `broken-backlinks` opportunity type (mapped to the same validator)
