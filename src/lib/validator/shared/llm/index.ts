export type { LLMValidator, LLMValidationContext } from './types';
export { registerLLM, getLLM, getDefaultLLM, listLLMs } from './registry';
export { openAIAdapter } from './openai-adapter';

import { registerLLM } from './registry';
import { openAIAdapter } from './openai-adapter';

registerLLM(openAIAdapter);
