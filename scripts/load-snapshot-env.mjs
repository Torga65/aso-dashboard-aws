/**
 * Load env from the repo root (same idea as Next: .env → .env.local → production files).
 * SPACECAT_API_KEY wins over SPACECAT_TOKEN (Next-style naming).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export function loadSnapshotEnv() {
  dotenv.config({ path: join(REPO_ROOT, '.env') });
  dotenv.config({ path: join(REPO_ROOT, '.env.local'), override: true });
  if (process.env.NODE_ENV === 'production') {
    dotenv.config({ path: join(REPO_ROOT, '.env.production'), override: true });
    dotenv.config({ path: join(REPO_ROOT, '.env.production.local'), override: true });
  }
  if (process.env.SPACECAT_API_KEY) {
    process.env.SPACECAT_TOKEN = process.env.SPACECAT_API_KEY;
  }
  if (process.env.SPACECAT_BASE_URL) {
    process.env.SPACECAT_API_BASE = process.env.SPACECAT_BASE_URL;
  }
}
