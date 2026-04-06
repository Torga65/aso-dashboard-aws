/**
 * Load config from env and optional .aso-validator.json.
 * Single place for env parsing; no env parsing inside opportunity modules.
 */

export interface AppConfig {
  spacecat: {
    apiKey: string;
    baseURL: string;
  };
  llm: {
    apiKey: string;
    provider: string;
    model: string;
    /** POST target for OpenAI-compatible chat completions. */
    openaiChatCompletionsUrl: string;
    /** Use `api-key` header (Azure-style) instead of `Authorization: Bearer`. */
    openaiUseApiKeyHeader: boolean;
    /** Omit `response_format` in the request body (for APIs that do not support it). */
    openaiDisableResponseFormat: boolean;
  };
}

const DEFAULT_SPACECAT_BASE_URL = 'https://spacecat.experiencecloud.live/api/v1';
const DEFAULT_LLM_PROVIDER = 'openai';
const DEFAULT_LLM_MODEL = 'gpt-4o-mini';
const DEFAULT_AZURE_API_VERSION = '2024-06-01';

/**
 * Azure OpenAI chat completions URL (deployment + api-version in path/query).
 *
 * If AZURE_OPENAI_ENDPOINT is only a resource root (e.g. https://name.openai.azure.com/),
 * builds `/openai/deployments/{AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=…`.
 * POSTing to the bare host often returns HTTP 200 with an empty body.
 */
export function resolveOpenAIChatCompletionsUrl(): string {
  const raw = process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? '';
  if (!raw) return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  const hasChatPath = /\/openai\/deployments\/[^/]+\/chat\/completions/.test(parsed.pathname);
  if (hasChatPath) {
    return raw;
  }

  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || DEFAULT_LLM_MODEL;
  const apiVersion =
    parsed.searchParams.get('api-version') || DEFAULT_AZURE_API_VERSION;
  const out = new URL(parsed.origin);
  out.pathname = `/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`;
  out.searchParams.set('api-version', apiVersion);
  return out.toString();
}

export function loadConfig(): AppConfig {
  const apiKey =
    process.env.SPACECAT_API_KEY ?? process.env.USER_API_KEY ?? '';
  const baseURL = process.env.SPACECAT_BASE_URL ?? DEFAULT_SPACECAT_BASE_URL;

  const llmApiKey = process.env.AZURE_OPENAI_KEY?.trim() ?? '';
  const llmProvider = process.env.LLM_PROVIDER ?? DEFAULT_LLM_PROVIDER;
  const llmModel =
    process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? DEFAULT_LLM_MODEL;
  const openaiChatCompletionsUrl = resolveOpenAIChatCompletionsUrl();
  const openaiUseApiKeyHeader =
    Boolean(process.env.AZURE_OPENAI_KEY?.trim()) ||
    process.env.OPENAI_USE_API_KEY_HEADER === '1' ||
    process.env.OPENAI_USE_API_KEY_HEADER?.toLowerCase() === 'true' ||
    process.env.OPENAI_AUTH_HEADER === 'api-key';
  const openaiDisableResponseFormat =
    process.env.OPENAI_DISABLE_RESPONSE_FORMAT === '1' ||
    process.env.OPENAI_DISABLE_RESPONSE_FORMAT?.toLowerCase() === 'true';

  return {
    spacecat: {
      apiKey,
      baseURL,
    },
    llm: {
      apiKey: llmApiKey,
      provider: llmProvider,
      model: llmModel,
      openaiChatCompletionsUrl,
      openaiUseApiKeyHeader,
      openaiDisableResponseFormat,
    },
  };
}
