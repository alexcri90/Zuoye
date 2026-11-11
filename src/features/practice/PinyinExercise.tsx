import { useState, type FormEvent } from 'react';
import { Zh } from '../../components/ui.tsx';
import { hanChars } from '../../lib/hanzi.ts';
import { applyTone, gradePinyin, numbersToMarks, syllablesOf, type PinyinGrade } from '../../lib/pinyin.ts';
import { ratePinyin } from '../../lib/practice.ts';
import type { Vocab } from '../../lib/schema.ts';
import type { Rating } from '../../lib/srs.ts';

const TONES = [
  { tone: 1, name: 'Primo tono' },
  { tone: 2, name: 'Secondo tono' },
  { tone: 3, name: 'Terzo tono' },
  { tone: 4, name: 'Quarto tono' },
];

function title(grade: PinyinGrade, gaveUp: boolean): string {
  if (grade.verdict === 'correct') return 'Giusto';
  if (gaveUp) return 'Ecco la risposta';
  if (grade.verdict === 'wrong') return 'Sillabe sbagliate';
  if (grade.verdict === 'tones' && grade.missing) return 'Sillabe giuste, mancano i toni';
  return 'Sillabe giuste, tono sbagliato';
}

function detail(grade: PinyinGrade, count: number): string | null {
  if (grade.verdict !== 'tones' || count < 2) return null;
  const places = grade.wrong.map((i) => i + 1).join(', ');
  const noun = grade.wrong.length === 1 ? 'sulla sillaba' : 'sulle sillabe';
  return `${grade.missing ? 'Tono mancante' : 'Tono sbagliato'} ${noun} ${places}.`;
}

/** Exercise 1: read the word, write its pinyin. */
export function PinyinExercise({ vocab, onDone }: { vocab: Vocab; onDone: (rating: Rating) => void }) {
  const [value, setValue] = useState('');
  const [grade, setGrade] = useState<PinyinGrade | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (grade) {
      onDone(ratePinyin(grade));
      return;
    }
    const result = gradePinyin(value, vocab.pinyin, vocab.hanzi);
    if (result.verdict !== 'empty') setGrade(result);
  };

  const several = vocab.pinyin.includes('/');
  const syllables = syllablesOf(vocab.pinyin, vocab.hanzi);
  const wrong = grade?.verdict === 'tones' && !several ? grade.wrong : [];

  return (
    <form className="exercise" onSubmit={submit} noValidate>
      <div className="prompt">
        <span className="prompt-label">Scrivi il pinyin</span>
        <Zh className={hanChars(vocab.hanzi).length > 3 ? 'zh-big long' : 'zh-big'}>{vocab.hanzi}</Zh>
      </div>

      {grade ? (
        <div className={grade.verdict === 'correct' ? 'feedback ok' : 'feedback bad'} role="status">
          <span className="feedback-title">{title(grade, gaveUp)}</span>
          <span className="syllables" lang="zh-Latn">
            {several
              ? vocab.pinyin
              : syllables.map((s, i) => (
                  <span key={i} className={wrong.includes(i) ? 'wrong' : undefined}>
                    {s}{' '}
                  </span>
                ))}
          </span>
          {detail(grade, syllables.length) && <span className="small">{detail(grade, syllables.length)}</span>}
          {grade.verdict !== 'correct' && !gaveUp && (
            <span className="small muted">
              La tua risposta: <span lang="zh-Latn">{value}</span>
            </span>
          )}
          <span>{vocab.meaning}</span>
        </div>
      ) : (
        <>
          <div className="tones" role="group" aria-label="Toni">
            {TONES.map(({ tone, name }) => (
              <button
                key={tone}
                type="button"
                className="tone"
                aria-label={name}
                // Keep the keyboard open: the button must not take the focus from the field.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setValue((v) => applyTone(v, tone) ?? v)}
              >
                {applyTone('a', tone)}
              </button>
            ))}
          </div>
          <input
            className="input pinyin-input"
            value={value}
            onChange={(e) => setValue(numbersToMarks(e.target.value))}
            aria-label="Pinyin"
            placeholder="pinyin"
            lang="zh-Latn"
            inputMode="text"
            enterKeyHint="done"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </>
      )}

      <div className="btn-row">
        {!grade && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setGaveUp(true);
              setGrade({ verdict: 'wrong' });
            }}
          >
            Non lo so
          </button>
        )}
        <button type="submit" className="btn btn-primary" autoFocus={grade !== null}>
          {grade ? 'Avanti' : 'Verifica'}
        </button>
      </div>
    </form>
  );
}
