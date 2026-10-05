import { config } from '../../../config.js';
import type { ExtractionProvider } from '../types.js';
import { HeuristicProvider } from './heuristic.js';
import { OpenAiVisionProvider } from './openaiVision.js';

const heuristic = new HeuristicProvider();

/**
 * Provider selection with a deliberate fallback: if the vision model is not
 * configured or fails, the shop still gets a usable extraction from the OCR
 * text instead of an error screen.
 */
export function getExtractionProvider(): ExtractionProvider {
  if (config.aiProvider === 'openai' && config.openAiApiKey) return new OpenAiVisionProvider();
  return heuristic;
}

export function getFallbackProvider(): ExtractionProvider {
  return heuristic;
}

export { HeuristicProvider, OpenAiVisionProvider };
