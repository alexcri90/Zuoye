import HanziWriter from 'hanzi-writer';
import { useEffect, useRef, useState } from 'react';
import type { WritingEffort } from '../lib/practice.ts';
import { loadStrokes } from '../lib/strokes.ts';
import { Zh } from './ui.tsx';

interface Props {
  char: string;
  /** Called once the character has been written to the end. */
  onComplete: (effort: WritingEffort) => void;
  /** Called when the user moves on from a character that has no stroke data. */
  onSkip: () => void;
}

type Status = 'loading' | 'ready' | 'showing' | 'done' | 'missing';

const HINT_AFTER_MISSES = 3;

/** One writing grid (田字格): the character is written stroke by stroke with the finger. */
export function HanziQuiz({ char, onComplete, onSkip }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const actions = useRef<{ outline: () => void; reveal: () => void } | null>(null);
  const latestComplete = useRef(onComplete);
  const [status, setStatus] = useState<Status>('loading');
  const [outlined, setOutlined] = useState(false);

  useEffect(() => {
    latestComplete.current = onComplete;
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    let timer = 0;
    const effort: WritingEffort = { revealed: false, outlined: false, hinted: false, mistakes: 0, strokes: 0 };
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const size = el.clientWidth || 300;

    const writer = HanziWriter.create(el, char, {
      width: size,
      height: size,
      padding: Math.round(size * 0.07),
      showCharacter: false,
      showOutline: false,
      strokeColor: color('--ink', '#1c1a17'),
      outlineColor: color('--hairline', '#e4ded3'),
      drawingColor: color('--ink-soft', '#6b665e'),
      highlightColor: color('--vermilion', '#c8372d'),
      highlightCompleteColor: color('--jade', '#3f7d6b'),
      drawingWidth: 6,
      charDataLoader: (c, onLoad, onError) => {
        loadStrokes(c).then(onLoad, onError);
      },
      onLoadCharDataSuccess: (data) => {
        if (!alive) return;
        effort.strokes = data.strokes.length;
        setStatus('ready');
      },
      onLoadCharDataError: () => {
        if (alive) setStatus('missing');
      },
    });

    const startQuiz = () =>
      void writer.quiz({
        showHintAfterMisses: HINT_AFTER_MISSES,
        highlightOnComplete: true,
        onMistake: (stroke) => {
          effort.mistakes++;
          if (stroke.mistakesOnStroke >= HINT_AFTER_MISSES) effort.hinted = true;
        },
        onComplete: () => {
          if (!alive) return;
          setStatus('done');
          timer = window.setTimeout(() => latestComplete.current({ ...effort }), 700);
        },
      });
    startQuiz();

    actions.current = {
      outline: () => {
        effort.outlined = true;
        setOutlined(true);
        void writer.showOutline();
      },
      reveal: () => {
        effort.revealed = true;
        writer.cancelQuiz();
        setStatus('showing');
        void writer.animateCharacter({
          onComplete: (result) => {
            if (!alive || result.canceled) return;
            void writer.hideCharacter({
              duration: 300,
              onComplete: () => {
                if (!alive) return;
                setStatus('ready');
                startQuiz();
              },
            });
          },
        });
      },
    };

    return () => {
      alive = false;
      window.clearTimeout(timer);
      actions.current = null;
      writer.cancelQuiz();
      el.replaceChildren();
    };
  }, [char]);

  return (
    <>
      <div className="tian" data-status={status} data-char={char}>
        <div ref={box} />
      </div>
      {status === 'missing' ? (
        <div className="stack" style={{ alignItems: 'center' }}>
          <p className="muted small">
            Tratti non disponibili per <Zh>{char}</Zh>: questo carattere viene saltato.
          </p>
          <button type="button" className="btn" onClick={onSkip}>
            Continua
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={status !== 'ready' || outlined}
            onClick={() => actions.current?.outline()}
          >
            Traccia
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={status !== 'ready'}
            onClick={() => actions.current?.reveal()}
          >
            Mostra
          </button>
        </div>
      )}
    </>
  );
}
