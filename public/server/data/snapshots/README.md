# Static snapshot JSON (portfolio)

These files are fetched by the dashboard as static assets (`/server/data/snapshots/…`).

- **`latest.json`** — points at the current default ASO portfolio file (`file`, `date`, `generatedAt`).
- **`latest-portfolio-cja.json`** — pointer for the CJA comparison snapshot (does not change `latest.json`).
- **`portfolio-aso-YYYY-MM-DD.json`** / **`portfolio-cja-YYYY-MM-DD.json`** — dated payloads.

Regenerate from the repo root:

```bash
npm run snapshot:portfolio:all
```

Requires `SPACECAT_API_KEY` (or `SPACECAT_TOKEN`) in `.env.local`. See `scripts/load-snapshot-env.mjs`.
