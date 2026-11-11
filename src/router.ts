/** Hash routing: works on any static host and under any sub-path. */
import { useMemo, useSyncExternalStore } from 'react';
import type { Mode } from './lib/practice.ts';
import { SKILLS } from './lib/schema.ts';

export type Route =
  | { name: 'home' }
  | { name: 'practice'; mode: Mode; extra: boolean }
  | { name: 'lessons' }
  | { name: 'lesson-new' }
  | { name: 'lesson'; id: string }
  | { name: 'settings' };

const MODES: readonly string[] = [...SKILLS, 'mista'];

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter((p) => p !== '');
  const [first, second] = parts;
  if (first === 'practice' && second !== undefined && MODES.includes(second)) {
    return { name: 'practice', mode: second as Mode, extra: new URLSearchParams(query).get('extra') === '1' };
  }
  if (first === 'lessons') {
    if (second === undefined) return { name: 'lessons' };
    if (second === 'new') return { name: 'lesson-new' };
    if (/^[\w-]{1,64}$/.test(second)) return { name: 'lesson', id: second };
    return { name: 'lessons' };
  }
  if (first === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

/** Goes to a route such as "/lessons". `replace` leaves no entry in the history. */
export function navigate(path: string, replace = false): void {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}
