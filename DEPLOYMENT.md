# Deployment Guide

## Prerequisites

- Node.js 20+
- AWS CLI configured (`aws configure`)
- Amplify CLI v2: `npm i -g @aws-amplify/backend-cli`

---

## Local Development

```bash
# Install dependencies
npm install

# Start the Amplify sandbox (deploys a personal backend to AWS)
npm run amplify:sandbox
# This writes amplify_outputs.json — required by the Next.js app

# In a second terminal, start Next.js
npm run dev
```

The sandbox deploys a full copy of your backend (AppSync, DynamoDB, Cognito, Lambda)
to your personal AWS account. It hot-reloads when you edit files in `amplify/`.

---

## Secrets

Lambda secrets are stored in AWS Secrets Manager — never in `.env` files.

```bash
# Set a secret (run once per environment)
npx ampx secret set EXTERNAL_API_KEY

# List secrets
npx ampx secret list
```

These are referenced in `amplify/functions/daily-fetch/resource.ts` via `secret("EXTERNAL_API_KEY")`
and injected as environment variables into the Lambda at runtime.

---

## Importing Existing Page Designs

1. Copy your existing design files into `src/components/pages/`.
2. Create a new route file in `src/app/<route-name>/page.tsx`.
3. Import and render your design component from the route file.

Example:
```tsx
// src/app/keywords/page.tsx
import { KeywordsPage } from "@/components/pages/KeywordsPage";
export default function Page() { return <KeywordsPage />; }
```

---

## Production Deployment (Amplify Hosting)

### First-time setup

1. Push this repo to GitHub.
2. Open the [AWS Amplify Console](https://console.aws.amazon.com/amplify/).
3. **New app → Host web app** → connect your GitHub repo.
4. Amplify detects `amplify.yml` automatically.
5. The first build deploys both backend and frontend.

### CI/CD flow (subsequent pushes)

```
git push origin main
  └─► Amplify Hosting detects push
        ├─► Backend: ampx pipeline-deploy  (CloudFormation stack update)
        └─► Frontend: next build            (SSR deployment to Amplify CDN)
```

### Branch environments

| Branch  | Environment  | Notes                              |
|---------|------------- |------------------------------------|
| `main`  | Production   | Auto-deployed on merge             |
| `dev`   | Staging      | Connect in Amplify Console as well |
| `*`     | Sandbox      | Use `ampx sandbox` locally         |

Set environment-specific variables in **Amplify Console → App settings → Environment variables**.

---

## Adding a New Page / Route

```
src/app/
  <route>/
    page.tsx      ← Server Component (data fetching)
    loading.tsx   ← Optional loading state
    error.tsx     ← Optional error boundary
```

Import your existing design as a component and render it in `page.tsx`.

---

## Adding a New Lambda Function

1. Create `amplify/functions/<name>/resource.ts` (use `defineFunction`).
2. Create `amplify/functions/<name>/handler.ts`.
3. Export the function from `amplify/backend.ts`.
4. Run `npm run amplify:sandbox` to deploy.

---

## Useful Commands

| Command                          | Purpose                                  |
|----------------------------------|------------------------------------------|
| `npm run amplify:sandbox`        | Deploy personal backend + watch for changes |
| `npm run amplify:deploy`         | Deploy to the CI/CD pipeline branch      |
| `npx ampx secret set KEY`        | Store a Lambda secret in Secrets Manager |
| `npx ampx generate outputs`      | Re-generate `amplify_outputs.json`       |
| `npm run typecheck`              | TypeScript type-check without building   |
