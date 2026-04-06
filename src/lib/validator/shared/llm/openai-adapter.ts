/**
 * OpenAI-compatible LLM validator (Azure OpenAI). Chat Completions API with JSON response.
 * Set AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT (see .env.example).
 */

import { loadConfig } from '@validator-shared/config';
import type { Suggestion, ValidationResult } from '@validator-shared/types';
import type { FixValidationResult, LLMValidator, LLMValidationContext } from './types';

/** SpaceCat metadata keys — excluded so the LLM sees payload + data fields, not duplicate ids/status. */
const SUGGESTION_META_KEYS = new Set([
  'opportunityId',
  'siteId',
  'status',
  'type',
  'createdAt',
  'updatedAt',
  'data',
]);

/**
 * JSON sent to the LLM: `data` plus any other top-level suggestion fields (e.g. suggestion, explanation, recommendedAction).
 */
export function suggestionJsonForLlm(s: Suggestion): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.data && typeof s.data === 'object' && !Array.isArray(s.data)) {
    Object.assign(out, s.data);
  }
  for (const [key, value] of Object.entries(s as Record<string, unknown>)) {
    if (key === 'id' || SUGGESTION_META_KEYS.has(key) || value === undefined) continue;
    out[key] = value;
  }
  out.id = s.id;
  return out;
}

function authHeaders(config: ReturnType<typeof loadConfig>['llm']): Record<string, string> {
  if (config.openaiUseApiKeyHeader) {
    return { 'api-key': config.apiKey };
  }
  return { Authorization: `Bearer ${config.apiKey}` };
}

type ChatResult = { ok: true; content: string } | { ok: false; errorMessage: string };

/**
 * POST chat completions and return assistant message content, or a clear error for UI/network/parse failures.
 */
async function chatCompletionContent(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorMessage: `Could not reach the LLM endpoint (${msg}). Check network, VPN, firewall, and that AZURE_OPENAI_ENDPOINT is correct.`,
    };
  }

  const text = await res.text();
  if (!res.ok) {
    const errBody = text.trim().slice(0, 500);
    return {
      ok: false,
      errorMessage: `LLM request failed with HTTP ${res.status}${errBody ? `: ${errBody}` : ' (empty body)'}`,
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      errorMessage:
        'LLM returned HTTP 200 with an empty body. Typical causes: wrong deployment in the URL, api-version mismatch, or the service dropped the response. Verify AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT match your Azure portal.',
    };
  }

  let data: { choices?: Array<{ message?: { content?: string | null } }> };
  try {
    data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string | null } }> };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errorMessage: `LLM response was not valid JSON (${reason}). First 240 chars: ${text.slice(0, 240)}`,
    };
  }

  const content = data.choices?.[0]?.message?.content;
  if (content == null || (typeof content === 'string' && !content.trim())) {
    return {
      ok: false,
      errorMessage:
        'LLM returned no assistant message (missing choices[0].message.content). Check deployment name, api-version, and whether the model supports the request (e.g. response_format).',
    };
  }
  return { ok: true, content: typeof content === 'string' ? content : String(content) };
}

function chatRequestBody(
  config: ReturnType<typeof loadConfig>['llm'],
  userContent: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You respond only with a JSON array. No markdown, no explanation outside the JSON.',
      },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
  };
  if (!config.openaiDisableResponseFormat) {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

function buildPrompt(suggestions: Suggestion[], context: LLMValidationContext): string {
  const summary = suggestions.map((s) => suggestionJsonForLlm(s));
  const hreflangPage =
    context.opportunityTypeId === 'hreflang'
      ? `
For hreflang: each item may include "pageSourceSnippet" — HTML fetched from the audited page. Treat it as the primary source of truth. Decide whether the reported issue is truly present (real_issue) or not (false_positive) based on that HTML (and any hreflang in HTTP Link headers if described in the text), not only on SpaceCat's wording. If pageSourceSnippet is missing, rely on the other fields and say so in your explanation.
`
      : '';
  return `You are validating AEM Sites Optimizer findings. For each suggestion, decide if it is a real issue that should be fixed or a false positive. Use all fields provided per item (including suggestion, explanation, recommendedAction, and nested data).
${hreflangPage}
Opportunity type: ${context.opportunityTypeId}${context.opportunityTitle ? ` (${context.opportunityTitle})` : ''}
${context.runbook ? `Guidance:\n${context.runbook}` : ''}

Suggestions (one per item; fields are merged from the suggestion payload and suggestion.data):
${JSON.stringify(summary, null, 2)}

Respond with a JSON array with one object per suggestion, in the same order. Each object must have:
- suggestionId: string (the suggestion id)
- validation_status: "real_issue" or "false_positive"
- explanation: string (brief reason)

Return only the JSON array, no other text.`;
}

/**
 * Suggestion validation (runs after issue validation via `validateFix`): OpenAI judges ESS/AI
 * proposed URLs and narrative coherence for broken-internal-links.
 */
function buildBrokenInternalLinksSuggestionFixPrompt(
  suggestions: Suggestion[],
  context: LLMValidationContext
): string {
  const summary = suggestions.map((s) => suggestionJsonForLlm(s));
  return `You are validating **AI-generated suggestions** for broken internal link findings. **Issue validation has already completed** — each item is a confirmed **real issue**. Your task is **suggestion validation only**: assess the proposed fix content from the product, not whether the broken link exists.

For **each** item, evaluate two things:

1. **Suggested links (URLs):** Look for proposed replacement or target URLs in fields such as urlsSuggested, urls_suggested, urlSuggested, url_suggested, or similar. For each URL, judge whether it is **valid** as a link target: well-formed http(s), appropriate for an internal link fix on the site, and not obviously malformed or contradictory. If the payload only lists a single URL or relative paths, infer how they resolve. If **no** suggested URLs are present, base your link judgment on recommendedAction, explanation, and other text only, and state that in your explanation.

2. **Rationale:** Inspect aiRationale, ai_rationale, explanation, recommendedAction, and related text. Judge whether the rationale is **coherent and valid**—logically consistent with the issue, supports the proposed fix, and is not empty or contradictory.

Set **fix_correct** to **true** only if **both** the link assessment and the rationale assessment pass for that item. If either fails, fix_correct: false and explain which aspect failed (links vs rationale).

Opportunity type: ${context.opportunityTypeId}${context.opportunityTitle ? ` (${context.opportunityTitle})` : ''}
${context.runbook ? `Additional guidance:\n${context.runbook}\n\n` : ''}

Suggestions (JSON per item; merged from suggestion payload and suggestion.data):
${JSON.stringify(summary, null, 2)}

Respond with a JSON array with one object per suggestion, in the same order. Each object must have:
- suggestionId: string (the suggestion id)
- fix_correct: boolean (true only if suggested links and rationale both pass as described)
- explanation: string (brief; mention links vs rationale when relevant)

Return only the JSON array, no other text.`;
}

function buildFixValidationPrompt(
  suggestions: Suggestion[],
  context: LLMValidationContext
): string {
  if (context.opportunityTypeId === 'broken-internal-links') {
    return buildBrokenInternalLinksSuggestionFixPrompt(suggestions, context);
  }

  const summary = suggestions.map((s) => suggestionJsonForLlm(s));
  const hreflangNote =
    context.opportunityTypeId === 'hreflang'
      ? "Hreflang: you already have pageSourceSnippet (live HTML) from the gate. The issue was classified as real_issue using that context. Judge whether SpaceCat's recommended change is correct and sufficient.\n\n"
      : '';
  return `You are validating whether the **suggested fix** from AEM Sites Optimizer is correct. Each item below is a finding that has already been confirmed as a real issue. Use every field provided for each item—including any of: suggestion, explanation, recommendedAction, and nested data keys—to judge whether the recommended change is correct and sufficient.

${hreflangNote}Opportunity type: ${context.opportunityTypeId}${context.opportunityTitle ? ` (${context.opportunityTitle})` : ''}
${context.runbook ? `Context and rules for validating the fix:\n${context.runbook}` : ''}

Suggestions (one per item; each is a confirmed real issue; fields are merged from the suggestion payload and suggestion.data):
${JSON.stringify(summary, null, 2)}

Respond with a JSON array with one object per suggestion, in the same order. Each object must have:
- suggestionId: string (the suggestion id)
- fix_correct: boolean (true if the suggested fix is correct and sufficient, false otherwise)
- explanation: string (brief reason)

Return only the JSON array, no other text.`;
}

function extractArray(body: string): unknown[] | null {
  const trimmed = body.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.indexOf('[');
    const jsonEnd = trimmed.lastIndexOf(']') + 1;
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      try {
        parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
    if (firstArray) return firstArray as unknown[];
  }
  return null;
}

function parseResponse(body: string, suggestionIds: string[]): ValidationResult[] {
  const arr = extractArray(body);
  if (!arr) {
    return suggestionIds.map((id) => ({
      suggestionId: id,
      validation_status: 'error',
      explanation: 'LLM response was not a valid JSON array',
    }));
  }
  const byId = new Map<string, ValidationResult>();
  for (const item of arr) {
    if (
      item &&
      typeof item === 'object' &&
      'suggestionId' in item &&
      typeof (item as { suggestionId: unknown }).suggestionId === 'string'
    ) {
      const o = item as { suggestionId: string; validation_status?: string; explanation?: string };
      const status =
        o.validation_status === 'false_positive'
          ? 'false_positive'
          : o.validation_status === 'real_issue'
            ? 'real_issue'
            : 'error';
      byId.set(o.suggestionId, {
        suggestionId: o.suggestionId,
        validation_status: status,
        explanation: typeof o.explanation === 'string' ? o.explanation : undefined,
      });
    }
  }
  return suggestionIds.map(
    (id) =>
      byId.get(id) ?? {
        suggestionId: id,
        validation_status: 'error',
        explanation: 'LLM did not return a result for this suggestion',
      }
  );
}

function parseFixValidationResponse(body: string, suggestionIds: string[]): FixValidationResult[] {
  const arr = extractArray(body);
  if (!arr) {
    return suggestionIds.map((id) => ({
      suggestionId: id,
      fixValidated: false,
      fixExplanation: 'LLM response was not a valid JSON array',
    }));
  }
  const byId = new Map<string, FixValidationResult>();
  for (const item of arr) {
    if (
      item &&
      typeof item === 'object' &&
      'suggestionId' in item &&
      typeof (item as { suggestionId: unknown }).suggestionId === 'string'
    ) {
      const o = item as { suggestionId: string; fix_correct?: boolean; explanation?: string };
      byId.set(o.suggestionId, {
        suggestionId: o.suggestionId,
        fixValidated: o.fix_correct === true,
        fixExplanation: typeof o.explanation === 'string' ? o.explanation : undefined,
      });
    }
  }
  return suggestionIds.map(
    (id) =>
      byId.get(id) ?? {
        suggestionId: id,
        fixValidated: false,
        fixExplanation: 'LLM did not return a result for this suggestion',
      }
  );
}

export const openAIAdapter: LLMValidator = {
  id: 'openai',
  label: 'OpenAI',

  async validate(
    suggestions: Suggestion[],
    context: LLMValidationContext
  ): Promise<ValidationResult[]> {
    const config = loadConfig();
    if (!config.llm.apiKey?.trim()) {
      return suggestions.map((s) => ({
        suggestionId: s.id,
        validation_status: 'error',
        explanation: 'LLM API key not configured (AZURE_OPENAI_KEY)',
      }));
    }

    if (suggestions.length === 0) return [];

    const prompt = buildPrompt(suggestions, context);
    const chat = await chatCompletionContent(
      config.llm.openaiChatCompletionsUrl,
      authHeaders(config.llm),
      JSON.stringify(chatRequestBody(config.llm, prompt))
    );
    if (!chat.ok) {
      return suggestions.map((s) => ({
        suggestionId: s.id,
        validation_status: 'error',
        explanation: chat.errorMessage,
      }));
    }
    const suggestionIds = suggestions.map((s) => s.id);
    return parseResponse(chat.content, suggestionIds);
  },

  async validateFix(
    suggestions: Suggestion[],
    context: LLMValidationContext
  ): Promise<FixValidationResult[]> {
    const config = loadConfig();
    if (!config.llm.apiKey?.trim()) {
      return suggestions.map((s) => ({
        suggestionId: s.id,
        fixValidated: false,
        fixExplanation: 'LLM API key not configured (AZURE_OPENAI_KEY)',
      }));
    }
    if (suggestions.length === 0) return [];

    const prompt = buildFixValidationPrompt(suggestions, context);
    const chat = await chatCompletionContent(
      config.llm.openaiChatCompletionsUrl,
      authHeaders(config.llm),
      JSON.stringify(chatRequestBody(config.llm, prompt))
    );
    if (!chat.ok) {
      return suggestions.map((s) => ({
        suggestionId: s.id,
        fixValidated: false,
        fixExplanation: chat.errorMessage,
      }));
    }
    const suggestionIds = suggestions.map((s) => s.id);
    return parseFixValidationResponse(chat.content, suggestionIds);
  },
};
