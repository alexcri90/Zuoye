/** Files in and out of the browser, and keeping the stored data safe from eviction. Browser only. */
import { ImportError, MAX_IMPORT_BYTES, parseImport, type Imported } from './backup.ts';

/** Offers a JSON file for saving. Nothing is uploaded: the file is built in the page. */
export function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reads and validates an exported file. Throws ImportError with a message in Italian. */
export async function readImport(file: Blob): Promise<Imported> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('Il file è troppo grande per essere un backup di Zuòyè.');
  return parseImport(await file.text());
}

export type Persistence = 'protetto' | 'non protetto' | 'non disponibile';

/** Whether the browser has promised not to evict the stored data when space runs low. */
export async function persistence(): Promise<Persistence> {
  if (!navigator.storage?.persisted) return 'non disponibile';
  return (await navigator.storage.persisted()) ? 'protetto' : 'non protetto';
}

/** Asks the browser to keep the data. Some browsers grant it silently, some ask, some only for installed apps. */
export async function askToPersist(): Promise<Persistence> {
  if (!navigator.storage?.persist) return 'non disponibile';
  try {
    return (await navigator.storage.persist()) ? 'protetto' : 'non protetto';
  } catch {
    return 'non protetto';
  }
}

/** Space used by the app on this device, in megabytes; null when the browser does not say. */
export async function usedMegabytes(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return typeof estimate?.usage === 'number' ? Math.round((estimate.usage / 1048576) * 10) / 10 : null;
  } catch {
    return null;
  }
}
