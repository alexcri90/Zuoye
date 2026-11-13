import { useState } from 'react';
import { ImportError } from '../../lib/backup.ts';
import { readImport } from '../../lib/files.ts';
import { count } from '../../lib/italian.ts';
import { useStore } from '../../store.ts';

/**
 * Picks an exported file and installs it: a backup replaces everything, a
 * lesson pack adds (or replaces) one lesson. Both ask before overwriting.
 */
export function ImportButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { data, db, refresh } = useStore();
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const imported = await readImport(file);
      if (imported.kind === 'backup') {
        const { lessons, cards } = imported.data;
        const summary = `${count(lessons.length, 'lezione', 'lezioni')} e ${count(cards.length, 'scheda di ripasso', 'schede di ripasso')}`;
        if (!window.confirm(`Il backup contiene ${summary}. Sostituisce tutto ciò che c'è ora su questo dispositivo. Continuare?`)) {
          setMessage({ text: 'Importazione annullata.', bad: false });
          return;
        }
        await db.replaceAll(imported.data);
        await refresh();
        setMessage({ text: `Backup ripristinato: ${summary}.`, bad: false });
      } else {
        const { lesson, vocab } = imported.bundle;
        if (data.lessons.some((l) => l.id === lesson.id)) {
          if (!window.confirm(`"${lesson.title}" c'è già. Sostituirla? I progressi su questa lezione andranno persi.`)) {
            setMessage({ text: 'Importazione annullata.', bad: false });
            return;
          }
          await db.deleteLesson(lesson.id);
        }
        await db.saveLesson(imported.bundle);
        await refresh();
        setMessage({ text: `Lezione importata: ${lesson.title} (${count(vocab.length, 'parola', 'parole')}).`, bad: false });
      }
    } catch (error) {
      setMessage({ text: error instanceof ImportError ? error.message : 'Non sono riuscito a importare il file.', bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className={`btn btn-block${primary ? ' btn-primary' : ''}`} aria-disabled={busy}>
        {busy ? 'Importo…' : label}
        <input
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // the same file can be chosen again
            if (file) void install(file);
          }}
        />
      </label>
      {message && (
        <p className={message.bad ? 'notice bad small' : 'notice small'} role={message.bad ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </>
  );
}
