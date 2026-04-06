# Broken internal links — validating suggested fixes

The **gate** loads the **URL From** page and checks that some `<a href>` (or `<area href>`) resolves to the same URL as **URL To**, treating absolute, root-relative, parent-relative, and protocol-relative `//` forms as equivalent after normalization (encoding and trailing slashes).

**Static HTML first:** the gate uses a normal HTTP `GET` (same as a simple crawler). If that request **fails** (blocked, timeout, non-2xx body) **or** the response has **no matching anchor**, the gate **falls back** to **Playwright** (headless Chromium): real browser navigation often succeeds where a simple `fetch` is blocked. The page is loaded with scripts enabled, we wait for a target `href` hint when possible, then the same anchor matching runs on `page.content()`. Set **`DISABLE_PLAYWRIGHT_FALLBACK=1`** to skip the browser (faster CI or when Chromium is not installed).

**Why you might not “see” Playwright:** (1) The matching anchor is already in the initial HTML, so the fallback never runs. (2) Chromium is **headless**—there is no browser window; watch the **terminal** where `npm run dev` runs for `[broken-internal-links]` logs when the fallback runs. Set **`ASO_LOG_PLAYWRIGHT=1`** to log more in production builds.

**`net::ERR_HTTP2_PROTOCOL_ERROR` in Playwright:** Some sites/CDNs disagree with Chromium’s HTTP/2 stack. The launcher passes **`--disable-http2`** and **`--disable-quic`**. If navigation still fails, set **`PLAYWRIGHT_USE_SYSTEM_CHROME=1`** in `.env` so Playwright uses your installed Google Chrome instead of bundled Chromium (requires Chrome installed).

**Timeouts / SPAs:** Navigation uses **`domcontentloaded`** (not `load`) so pages that never finish loading subresources still proceed. Tunables: **`PLAYWRIGHT_GOTO_TIMEOUT_MS`** (default 60000), **`PLAYWRIGHT_POST_LOAD_SETTLE_MS`** (default 4000), **`PLAYWRIGHT_WAIT_FOR_ANCHOR_MS`** (default 30000).

**Bot / WAF detection (heuristic):** When validation cannot conclude or finds no link, the explanation may append **`[Possible bot/WAF interference]`** if HTTP status (401/403/429), HTML copy (e.g. captcha, CDN challenge, “unusual traffic”), or error text suggests automation blocking. This is **not** a guarantee — only a hint for operators.

**Angular / SPA:** A URL that appears only in **bundled JS** (or “Angular source”) is not a DOM link yet. The gate only counts `<a href>` / `<area href>` in HTML or in the **rendered** document. After Playwright loads the page, the validator waits (up to ~20s) for an anchor whose `href` contains the last path segment of **URL To** (e.g. `quantum-view`) before reading `page.content()`, so client-rendered menus have time to mount.

If that link is present, the gate then requests **URL To** (HEAD, with GET fallback if HEAD is not allowed) and checks for a successful HTTP response (2xx after redirects). If the target does not respond successfully, the finding is a **real issue** (broken link) without waiting for the LLM issue-classification step.

Use the suggestion fields together with any **pageSourceSnippet** (HTML from URL From) SpaceCat provides.

### Suggestion validation (OpenAI, after issue validation)

After the **issue** is classified as a **real issue**, the **second** LLM call (`validateFix`) performs **suggestion validation** for this opportunity type. It uses Azure OpenAI (same deployment as other validators) to judge:

1. **Suggested links** — URLs in fields such as `urlsSuggested` / `urlSuggested` (and snake_case variants): well-formed, plausible internal targets, not obviously wrong.
2. **Rationale** — Text in `aiRationale` / `ai_rationale` and related fields: coherent, consistent with the issue, and supportive of the proposed fix.

`fix_correct` in the API response maps to **Valid suggestion** in the UI only when **both** pass. Configure LLM env vars per `.env.example` (`AZURE_OPENAI_*`).

- A **real issue** (post–AI review) means the internal link target is actually broken for visitors (404/410, redirect loop, or wrong destination) on the audited site.
- If the gate **cannot find** a matching link in source, this is **not a valid issue** — treat as **false positive** (the reported broken link is not present on the page in HTML source).
- When judging the **recommended fix**, prefer updating or removing the bad href, fixing the destination page, or correcting site structure—match what the product team would ship.
