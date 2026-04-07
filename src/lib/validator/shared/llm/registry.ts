/**
 * Registry of LLM adapters. Add new providers by implementing LLMValidator and registering here.
 */

import { loadConfig } from '@validator-shared/config';
import type { LLMValidator } from './types';

const registry = new Map<string, LLMValidator>();

export function registerLLM(validator: LLMValidator): void {
  registry.set(validator.id, validator);
}

export function getLLM(id: string): LLMValidator | undefined {
  return registry.get(id);
}

/**
 * Returns the LLM adapter for the configured provider, or undefined if not configured.
 */
export function getDefaultLLM(): LLMValidator | undefined {
  const config = loadConfig();
  if (!config.llm.apiKey?.trim()) return undefined;
  const adapter = registry.get(config.llm.provider);
  return adapter ?? undefined;
}

export function listLLMs(): { id: string; label: string }[] {
  return Array.from(registry.values()).map((v) => ({ id: v.id, label: v.label }));
}
