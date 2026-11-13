import { useEffect, useMemo, useState } from 'react';
import { TabBar } from './components/ui.tsx';
import { Home } from './features/home/Home.tsx';
import { AddLesson } from './features/lessons/AddLesson.tsx';
import { LessonDetail } from './features/lessons/LessonDetail.tsx';
import { Lessons } from './features/lessons/Lessons.tsx';
import { Practice } from './features/practice/Practice.tsx';
import { Settings } from './features/settings/Settings.tsx';
import { openDatabase, type Database, type Snapshot } from './lib/db.ts';
import { loadPrefs, savePrefs } from './lib/settings.ts';
import { useRoute } from './router.ts';
import { StoreContext, type Store } from './store.ts';

export function App() {
  const route = useRoute();
  const [db, setDb] = useState<Database | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [prefs, setPrefs] = useState(() => loadPrefs());

  useEffect(() => {
    let alive = true;
    let opened: Database | undefined;
    openDatabase()
      .then(async (database) => {
        opened = database;
        const snapshot = await database.snapshot();
        if (!alive) {
          database.close();
          return;
        }
        setDb(database);
        setData(snapshot);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      opened?.close();
    };
  }, []);

  const store = useMemo<Store | null>(() => {
    if (!db || !data) return null;
    return {
      db,
      data,
      prefs,
      refresh: async () => setData(await db.snapshot()),
      saveCard: async (card) => {
        await db.putCard(card);
        setData((prev) => prev && { ...prev, cards: [...prev.cards.filter((c) => c.key !== card.key), card] });
      },
      saveSentence: async (sentence) => {
        await db.putSentence(sentence);
        setData((prev) => prev && { ...prev, sentences: prev.sentences.map((s) => (s.id === sentence.id ? sentence : s)) });
      },
      setPrefs: (patch) => setPrefs(savePrefs(patch)),
    };
  }, [db, data, prefs]);

  if (failed) {
    return (
      <div className="app">
        <main className="page">
          <div className="notice bad stack">
            <p>Non riesco ad aprire l&apos;archivio di questo browser.</p>
            <p className="small">
              Succede con la navigazione privata o se lo spazio è esaurito. Riprova in una finestra normale.
            </p>
          </div>
        </main>
      </div>
    );
  }
  if (!store) return <div className="app" aria-busy="true" />;

  return (
    <StoreContext value={store}>
      <div className="app">
        {route.name === 'practice' ? (
          <Practice key={`${route.mode}-${route.extra}`} mode={route.mode} extra={route.extra} />
        ) : (
          <>
            {route.name === 'home' && <Home />}
            {route.name === 'lessons' && <Lessons />}
            {route.name === 'lesson-new' && <AddLesson />}
            {route.name === 'lesson' && <LessonDetail key={route.id} id={route.id} />}
            {route.name === 'settings' && <Settings />}
            <TabBar current={route.name === 'home' || route.name === 'settings' ? route.name : 'lessons'} />
          </>
        )}
      </div>
    </StoreContext>
  );
}
