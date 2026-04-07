/**
 * Load per-opportunity-type context from the repo for LLM fix validation.
 * Reads opportunities/<typeId>/context.md from the project root (if present).
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

/** Safe filename segment: only allow alphanumeric and hyphen (e.g. hreflang, sitemap). */
function safeTypeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '') || 'unknown';
}

/**
 * Returns the content of opportunities/<typeId>/context.md, or empty string if missing.
 * Used as runbook/guidance when asking the LLM to validate the suggested fix for real issues.
 */
export async function getContextForOpportunityType(typeId: string): Promise<string> {
  if (!typeId?.trim()) return '';
  const segment = safeTypeId(typeId.trim());
  const path = join(process.cwd(), 'src', 'lib', 'validator', 'opportunities', segment, 'context.md');
  try {
    const content = await readFile(path, 'utf-8');
    return typeof content === 'string' ? content.trim() : '';
  } catch {
    return '';
  }
}
