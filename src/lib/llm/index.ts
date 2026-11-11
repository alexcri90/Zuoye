import { countRequest, getApiKey, type Prefs } from '../settings.ts';
import { createGemini } from './gemini.ts';
import type { Provider } from './provider.ts';

/** The provider configured in Settings. The key is read at call time and stays in this closure. */
export function currentProvider(prefs: Pick<Prefs, 'model' | 'fallbackModel'>): Provider {
  return createGemini({
    apiKey: getApiKey(),
    model: prefs.model,
    fallbackModel: prefs.fallbackModel,
    onRequest: () => countRequest(Date.now()),
  });
}

export const hasApiKey = (): boolean => getApiKey() !== '';
