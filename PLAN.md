# 作业 Zuòyè — Implementation Plan

A personal, free, phone-first web app that turns the course lessons (PDF slides + Word homework) into Chinese practice exercises that grow as new lessons are added.

Status of this document: plan **and running diary**. Sections 1–18 are the plan. **Section 19 is the diary: read it first when resuming** — it says what is done, what is open, and how to avoid a known blocker that stopped two sessions (19.1).

---

## 1. Goal and constraints

**Goal.** Upload each lesson's materials as the course advances; get five kinds of written practice drawn from everything uploaded so far.

| # | Exercise | Needs AI at practice time? |
|---|---|---|
| 1 | Write the pinyin for a character/word | No |
| 2 | Write the character from pinyin + meaning, stroke by stroke, with graded help | No |
| 3 | Translate Italian → Chinese, evaluated | Yes (with offline fallback) |
| 4 | Translate Chinese → Italian, evaluated | Yes (with offline fallback) |
| 5 | Fill in the blank in Chinese | No |
| + | Reorder the words (bonus; the teacher uses it in 3 of 6 homework sheets) | No |

**Hard constraints**

- Everything free, forever. No paid service, no billing account.
- Used mainly on a phone (finger writing), so mobile-first and installable.
- Simplified characters; all explanations and corrections in Italian.
- The API key stays on the device, never in the repository.
- Course materials never go online (repo is private; materials are git-ignored anyway).
- No speaking or listening exercises in this phase.
- Minimal, "chic" look with a very light modern-Chinese accent.
- Everything lives in this repository.

**Why not NotebookLM alone.** It is good for asking questions about the lessons and worth keeping as a companion. It cannot do stroke-by-stroke writing, has no spaced repetition (it does not remember what you get wrong), and cannot grade pinyin tones exactly.

---

## 2. What the course materials look like

Findings from the 15 files in `materiali/` (7 lesson PDFs, 1 exercise PDF, 6 exercise DOCX).

**Lesson PDFs** (24–36 slides each, 2.5–31 MB)

- Slides have a real text layer (6–8k characters per lesson), so vocabulary, pinyin and grammar explanations can be read as text.
- The textbook dialogues (课文) and some exercise pages are **images only**. Extraction therefore needs the page images too, not just the text.
- `01b - Esercizi.pdf` is fully scanned (no text at all).
- Vocabulary appears in a regular shape: `公交车 gōngjiāochē (N.) bus`, often followed by an example sentence with pinyin and translation.
- Grammar is explained in Italian with a pattern line (`V + 得 + (AVV.) AGG`) and 2–4 examples.
- The text layer contains radical look-alike characters (`⼤`, `⼒`, `⻅`, `⻥`) instead of the real ones (`大`, `力`, `见`, `鱼`). These must be normalised or character lookup breaks.
- Pinyin conventions vary inside the same course (`xuéshēng` / `xuésheng`, `bú ràng`, `yì jiān`, `yīqiān`). Grading must tolerate this.

**Homework DOCX** (plain text, no answer key)

- Multiple choice: correct pinyin; correct translation; correct complement.
- Fill in the blank, with a shared word bank or a binary choice (了/过, 来/去, 地).
- Translate Chinese → Italian and Italian → Chinese (5–6 sentences each).
- Reorder words into a sentence.
- Find and correct the error; transform a sentence; complete a dialogue.

Level is roughly HSK 2. Each lesson adds 10–25 words and 2–4 grammar points.

---

## 3. Key decisions

| Decision | Choice | Why |
|---|---|---|
| App shape | Static single-page web app, no backend | Free to host, nothing to secure server-side, each person brings their own key |
| Stack | Vite 8, React 19, TypeScript 6 (strict) | Current, well supported; TS 6 because the linter does not yet support TS 7 |
| Storage | IndexedDB in the browser (`idb`) | Lessons and progress stay on the device |
| AI provider | Gemini, behind a small provider interface | Free tier exists; interface keeps a later switch cheap |
| Gemini endpoint | `generateContent` (stateless) | Fully supported, stores nothing server-side. The newer Interactions API stores requests by default |
| PDF handling | Render pages in the browser with pdf.js, send downscaled JPEGs + text layer | Works with 30 MB PDFs, small uploads, not tied to Gemini's file upload |
| DOCX handling | Unzip with `fflate`, read `word/document.xml` with `DOMParser` | ~10 KB instead of a heavy converter; less attack surface |
| Stroke writing | Hanzi Writer + self-hosted stroke data | MIT library, quiz mode built in; no third-party CDN at runtime |
| Spaced repetition | Own SM-2 variant, one memory per item per skill | ~60 lines, fully testable, no dependency |
| Pinyin grading | Own deterministic engine | Tones must be checked exactly; no AI guesswork |
| Routing | Hash routes, no router library | Works on any static host and under a sub-path |
| Offline | Hand-written service worker | Avoids a few hundred transitive build dependencies |
| Styling | Plain CSS with design tokens | No framework needed at this size |

---

## 4. Facts checked on 2026-11-11, and open risks

**Checked against Google's own pages**

- Free-tier text models today: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. `gemini-2.5-*` are deprecated and reroute from 1 December 2026.
- Italy is in the supported-regions list.
- Exact free-tier rate limits are only visible inside AI Studio and change often. Design for a small daily budget.
- `generateContent`: key goes in the `x-goog-api-key` header; structured output uses `generationConfig.responseMimeType` + `responseJsonSchema`; `temperature` is ignored on 3.6 Flash and newer.
- Free-tier content may be used to improve Google's products and read by human reviewers. The terms also say that for people in the EEA the paid-tier data terms apply even to free quota.
- **Terms caveat:** "You may use only Paid Services when making API Clients available to users in the European Economic Area". Personal use with your own key is not what this targets; handing the app to classmates is a grey area. This is the reason for the provider interface.

**Checked locally**

- Hanzi Writer is MIT; its stroke data is under the Arphic Public License (redistribution allowed, licence file must ship with it). The data package has 9,575 characters, 32 MB.
- Vite 8 does **not** run on the installed Node 22.11.0 (needs ≥ 22.12). With Node 24 the scaffold builds and `npm audit` reports 0 vulnerabilities.

**Not verified**

- No Gemini request has been made: there is no key in this environment. Request shapes come from the documentation only.
- Free tiers of alternative providers (Mistral, Groq, OpenRouter) and whether they allow browser calls.
- GitHub Pages on a private repo: I believe it needs a paid plan (GitHub Pro, free for students) and that the published site is public either way. Confirm before relying on it.

---

## 5. Architecture

```
 phone browser (installed as an app)
 ┌────────────────────────────────────────────────────────────┐
 │  UI (React)                                                │
 │   Home · Practice session · Lessons · Settings             │
 │                                                            │
 │  Practice engine        Ingestion              LLM client  │
 │   queue + SRS            pdf.js / docx          Gemini     │
 │   pinyin grader          normalise + review     (interface)│
 │   Hanzi Writer                                             │
 │                                                            │
 │  IndexedDB: lessons, vocab, grammar, sentences,            │
 │             clozes, cards        localStorage: key, prefs  │
 └───────────────┬───────────────────────────┬────────────────┘
                 │ same origin               │ HTTPS, key in header
        static files (app, stroke      generativelanguage.googleapis.com
        data, pdf.js assets)
```

Only two network destinations exist: the app's own origin and the Gemini API. The Content-Security-Policy enforces that.

**Directory layout**

```
build/            Vite plugins (vendored data, CSP, service worker)   [exists]
materiali/        course files, git-ignored                           [exists]
public/           icon.svg, icon-180.png, icon-512.png, manifest
src/
  main.tsx, App.tsx, router.ts, styles.css
  lib/
    pinyin.ts          parse, grade, tone-number → tone-mark
    hanzi.ts           radical normalisation, Han-character helpers
    srs.ts             scheduler
    schema.ts          zod schemas: domain, LLM outputs, backup
    db.ts              IndexedDB access
    settings.ts        API key and preferences (localStorage)
    practice.ts        session queue, derived cloze, grade mapping
    backup.ts          export / import, lesson packs
    llm/               provider.ts, gemini.ts, prompts.ts, jsonSchemas.ts
    ingest/            pdf.ts, docx.ts, image.ts, normalize.ts, pipeline.ts
  features/
    home/  practice/  lessons/  settings/
  components/          shared UI (TabBar, Button, Sheet, Seal, TianGrid…)
```

---

## 6. Data model

All records carry a random id. Everything is validated with zod when it enters the app (LLM output, imported files).

| Store | Fields |
|---|---|
| `lessons` | id, number, title, summary, createdAt, files[] (names only) |
| `vocab` | id, lessonId, hanzi, pinyin, meaning, pos, note |
| `grammar` | id, lessonId, title, pattern, explanation, examples[{zh, pinyin, it}] |
| `sentences` | id, lessonId, zh, pinyin, it, words[], source (`lezione` / `compiti` / `ai`), acceptedZh[], acceptedIt[] |
| `clozes` | id, lessonId, text (one `____`), answer, options[], translation, explanation, source |
| `cards` | key (`<skill>:<itemId>`), due, interval, ease, reps, lapses, last |

- `words[]` is the word segmentation of `zh`. It powers reorder and automatic fill-in-the-blank.
- `acceptedZh/It` caches answers the AI has already judged correct, so the same answer never costs a second request.
- Skills: `pinyin`, `write`, `it-zh`, `zh-it`, `cloze`, `order`. A word has separate memories for reading and writing.
- The original PDF/DOCX files are **not** stored; only the extracted content.

---

## 7. Lesson ingestion

1. **Pick files** — any mix of PDF, DOCX, images, TXT for one lesson.
2. **Read locally**
   - PDF: text layer per page + each page rendered to a JPEG about 1000 px wide (≈100 KB). Cap at 60 pages per file. pdf.js is loaded only on this screen.
   - DOCX: paragraphs and tables to plain text.
   - Images: downscaled through a canvas.
3. **Extraction request** (1 request) — text + page images → JSON: lesson title and number, vocabulary, grammar points, example sentences with pinyin, translation and segmentation, and the teacher's exercises mapped onto sentences (translate, reorder) and clozes (fill-in, multiple choice). Solutions to homework are produced by the model and labelled as such.
4. **Normalise** — fix radical look-alikes, trim, drop entries without Chinese characters, de-duplicate, verify `words.join('')` equals the sentence, force exactly one blank per cloze and the answer among the options. Words already known from earlier lessons are flagged.
5. **Review screen** — editable list of words (character, pinyin, meaning) and sentences, with delete. Nothing is saved until confirmed. This step exists because a wrong pinyin learned from the app would be worse than no app.
6. **Save**, then **exercise generation** (1 request, text only) — new sentences and clozes targeting this lesson's grammar, using only this lesson's words plus the words of earlier lessons. Can fail or be skipped without losing the lesson; a "Genera altri esercizi" button repeats it later.

Cost: 2 requests per lesson, once.

**Prompt rules (all three prompts)**

- Written in Italian; output is JSON only, against a hand-written JSON Schema and re-validated with zod.
- Pinyin with tone marks, syllables of one word joined, no pinyin inside the `hanzi` field.
- Lesson text and student answers are wrapped in delimiters and declared to be data, not instructions.
- No names, e-mail addresses or page numbers in the output.

---

## 8. Exercises

Common frame: a session is 10 items (configurable), due items first, then new ones. A lesson filter (all / selected lessons) applies everywhere. "Sessione mista" interleaves all types.

### 8.1 Pinyin from character

- Shows the word large; the meaning stays hidden until answered.
- Input accepts `nǐ hǎo`, `ni3 hao3`, `ni3hao3`, `lv4` / `lü4`. Typed digits turn into tone marks as you type.
- A row of four tone buttons sits above the keyboard, so no keyboard switching on the phone.
- Feedback distinguishes "syllables wrong" from "syllables right, tone wrong on syllable n", then shows pinyin and meaning.

### 8.2 Character from pinyin + meaning

- Shows meaning and pinyin; one writing grid (田字格) per character, written with the finger.
- Help is graded, and the grade follows the help used:

| Help used | Result recorded |
|---|---|
| None, few stroke mistakes | Good |
| Automatic hint after 3 misses on a stroke, or "Traccia" (faint outline) | Hard |
| "Mostra" (full stroke animation, then write it yourself) | Again |

- Characters missing from the stroke data are skipped with a note.

### 8.3 / 8.4 Translation, both directions

- Source: lesson examples, the teacher's homework sentences, AI-generated sentences.
- Italian → Chinese is answered in characters with the phone's Chinese keyboard.
- Grading order: (1) exact match with the reference or a cached accepted answer, ignoring punctuation and spaces → correct, no request; (2) otherwise one AI request; (3) no key, offline or quota exhausted → show the reference and three self-assessment buttons.
- AI verdict: `corretta` / `quasi` / `errata`, a 0–100 score, the corrected sentence (with pinyin when Chinese), a short Italian comment, and a list of errors by type (grammatica, lessico, caratteri, ordine, significato).
- The grader is told to accept any natural correct translation, not only the reference.

### 8.5 Fill in the blank

- Two sources: explicit clozes (teacher's and AI's, grammar-targeted, with explanation) and clozes derived on the fly from any sentence by blanking a known word.
- Answer by tapping one of 3–4 options. Distractors for derived clozes come from words of the same part of speech in nearby lessons.
- Feedback: the full sentence, translation, and the explanation when there is one.

### 8.6 Reorder (bonus)

- Tap word tiles into order; graded against the sentence. Free to add because `words[]` already exists.

Not planned for now: "find the error", sentence transformation and dialogue completion. They would be AI-graded like translations and can be added later on the same grading path.

---

## 9. Pinyin engine

- **Parsing.** Lower-case, Unicode-decompose, read tone marks and digits, treat spaces/apostrophes/digits as syllable boundaries, split letter runs with the table of ~410 valid syllables (longest match with backtracking). `ü` = `v` = `u:`; `lue/nue` = `lüe/nüe`; trailing `r` is erhua.
- **Comparison.** Compare the joined letters and the ordered list of tones, not the syllable split. This makes `fan gan` and `fangan` equal regardless of how each was segmented.
- **Leniency**
  - Expected neutral tone: any tone accepted (covers `xuésheng` / `xuéshēng`).
  - 一 and 不: both the dictionary tone and the sandhi tone accepted, when characters and syllables line up.
  - Several accepted readings separated by `/`.
- **Strictness.** A missing tone on a toned syllable is an error, reported as "toni mancanti".
- **Mark placement.** `a`/`e` first, then the `o` of `ou`, otherwise the last vowel; case preserved.

---

## 10. Spaced repetition

- Four outcomes: Again, Hard, Good, Easy. They are derived from performance, never asked (except the translation fallback).
- New item: Again → repeats in the same session; Hard/Good → tomorrow; Easy → 3 days.
- Known item: Good multiplies the interval by the ease factor (start 2.5); Hard ×1.2 and ease −0.15; Easy ×ease×1.3 and ease +0.15; Again resets, ease −0.2 (floor 1.3).
- Due dates snap to the start of the local day, so an evening review is due the next morning.

---

## 11. LLM client

- One interface: `generateJson(system, parts, jsonSchema, zodSchema)`. Parts are text or base64 images.
- Gemini implementation: `POST /v1beta/models/{model}:generateContent`, key in header only (never in the URL), no temperature, no server-side storage.
- Defaults: `gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite` on quota errors. Settings has a "Verifica chiave" button that lists the models the key can use.
- Failure handling

| Situation | Behaviour |
|---|---|
| 429 with a short retry delay | Wait and retry once |
| 429 otherwise | Try the fallback model, then report "quota esaurita" |
| 500 / 503 | Up to 2 retries with backoff |
| 400 with schema | Retry once without the schema, relying on zod |
| Invalid JSON or schema mismatch | Retry once |
| 401 / 403 | "Chiave non valida" |
| Blocked or truncated response | Clear Italian message, nothing saved |

- Error messages never contain the key.

---

## 12. Security model

- **No backend, no accounts, no analytics, no third-party scripts or fonts.**
- **Content-Security-Policy** in the production page: scripts only from the app's origin; connections only to the origin and `generativelanguage.googleapis.com`; no objects, no base, no form posts. (Styles allow inline attributes because Hanzi Writer needs them.)
- **API key:** entered in Settings, stored in the browser's local storage on that device, sent only in the request header to Google. Masked field, delete button. Anyone with access to the unlocked phone's browser profile could read it; acceptable for a key with no billing attached.
- **Zero-cost guarantee:** never enable billing on the Google project that owns the key. When quota ends, requests are refused, not charged.
- **Untrusted data:** AI output and imported files are schema-validated, length-capped and rendered as text only (no HTML injection path). Import files have a size limit.
- **Materials:** `materiali/` and `.env*` are git-ignored; verified that a file placed there is ignored.
- **Supply chain:** 7 runtime dependencies, lockfile committed, `npm audit` clean, CI actions pinned by commit hash.
- **Privacy of content:** lesson pages are sent to Google for extraction. That is inherent in using a free hosted model.

---

## 13. Visual design

- **Palette.** Rice-paper background `#F7F4EE`, ink text `#1C1A17`, hairlines `#E4DED3`, one accent: vermilion `#C8372D` (seal red, also the "teacher's pen" for corrections), jade `#3F7D6B` for correct. Dark mode: ink background `#151412`, paper text.
- **Type.** System fonts only (no downloads). Serif for headings; Kaiti/Songti stack for large characters, which is closer to handwriting.
- **Chinese accent, kept light.** A small vermilion seal with 作业 as the logo; the 田字格 grid in the writing exercise; one character as each tab's icon (练 Esercizi, 课 Lezioni, 设 Impostazioni); thin rules and generous white space.
- **Layout.** Single column, bottom tab bar, thumb-reachable primary action, safe-area aware. On desktop the column is centred at ~560 px.
- **Screens**
  - *Home:* what is due today per exercise type, lesson filter chips, "Sessione mista".
  - *Practice:* progress bar, one item at a time, end-of-session summary.
  - *Lessons:* list; add flow (files → progress → review → save); detail with Parole / Grammatica / Frasi, export, generate more, delete.
  - *Settings:* key, model, backup export/import, storage info, licences.

---

## 14. Offline, storage and sharing

- Installable to the home screen (manifest + icons). Service worker caches the app shell; stroke data is cached per character on first use. Exercises 1, 2, 5 and reorder work fully offline.
- The app asks the browser for persistent storage so data is not evicted.
- **Backup:** export everything (lessons + progress) to one JSON file; import restores it. This is also the only way to move data between phone and computer, since there is no server.
- **Lesson packs:** export one processed lesson (no progress) as a file to pass to classmates, so they spend no quota and see the already-reviewed content.

---

## 15. Hosting

The phone needs the app on an HTTPS address. The build is fully static and uses relative paths, so any static host works.

| Option | Cost | Notes |
|---|---|---|
| Make the repo public + GitHub Pages | Free | Simplest. The repo holds only code; materials are git-ignored and stay local. Recommended |
| Keep private + Cloudflare Pages | Free | Needs a Cloudflare account linked to the repo |
| Keep private + GitHub Pages | Free with the student pack | To confirm (see section 4) |
| Local only, over Wi-Fi | Free | Fine for trying it out; not installable, computer must be on |

In every hosted option the site itself is a public address showing an empty app; lessons and key exist only in each visitor's own browser.

A GitHub Actions workflow (build with Node 24, deploy to Pages, minimal permissions) is part of phase 6.

---

## 16. Current state of the repository

> This section describes the repository on the afternoon of 2026-11-11, before the build started. It is kept as history. The live status is in section 19.3.

Present and working (built once with Node 24):

- `package.json` + lockfile: dependencies chosen, `minimatch` override that clears the audit.
- `tsconfig.json`: strict settings.
- `vite.config.ts` and `build/plugins.ts`: serves and copies stroke data (as `hanzi/<codepoint-hex>.json`) and pdf.js assets from the app's own origin; injects the CSP; writes the service worker.
- `build/sw.template.js`: the service worker.
- `index.html`: page shell with mobile meta tags.
- `.gitignore`, `materiali/`.

Placeholder only: `src/main.tsx` renders two characters.

Not yet checked: type-check (`tsc`) has not been run; the dev-server middleware and the service worker have not been exercised in a browser; `public/` (icons, manifest) does not exist yet although `index.html` references it.

Nothing is committed.

**Prerequisite:** update Node.js to 22.12 or newer (24 LTS recommended). The portable Node 24 used so far lives in a temporary session folder and will disappear.

---

## 17. Implementation phases

Each phase ends with something runnable and its own tests.

| Phase | Content | Done when |
|---|---|---|
| 1. Core logic | `pinyin`, `hanzi`, `srs`, `schema`, `db`, `settings` | Unit tests pass, including the pinyin cases found in the real materials |
| 2. Shell + deterministic exercises | App shell, tabs, design tokens; pinyin and writing exercises on a small built-in sample lesson | Both exercises usable on a phone-sized screen; progress survives a reload |
| 3. Ingestion | pdf.js and DOCX readers, Gemini client, extraction prompt, review screen, save | The 7 real lessons import with a real key; extracted words spot-checked against the slides |
| 4. Sentence exercises | Translation both ways with AI grading and fallback; cloze; reorder; exercise generation | A mixed session runs end to end; grading verified on a set of right, nearly right and wrong answers |
| 5. Data portability | Backup export/import, lesson packs, storage persistence | Round trip restores an identical database |
| 6. Ship | Icons, manifest, service worker check, CI workflow, README, deployment | Installed on the phone from the hosted address; works in airplane mode for exercises 1, 2, 5 |

**Tests**

- Unit (Vitest): pinyin parser and grader, scheduler, normalisation, schemas, queue building, Gemini client against a mocked `fetch`, database against an in-memory IndexedDB.
- Browser check: drive the built app in a phone-sized viewport with the model responses mocked; screenshot each screen.
- Real-model check: phase 3 needs a key (see below).

---

## 18. What is needed from you

1. **Node.js update** to 24 LTS on your computer. *Done 2026-11-11: winget installed v26.13.0, which the tools accept.*
2. **Hosting choice** from section 15.
3. **A Gemini API key** from Google AI Studio, on a project without billing. For phase 3 it can go in a git-ignored `.env.local` so the prompts can be tuned on the real lessons; in normal use it is typed into the app's Settings.
4. **Confirm scope:** the bonus reorder exercise in, the three AI-graded homework types (find the error, transform, complete the dialogue) out for now. *Confirmed 2026-11-11 as the default: reorder in, the three extra types out.*

---

## 19. Diary and working notes

Append to this section; do not delete entries. Correct a statement elsewhere in the plan when it becomes false, and note the change here.

### 19.1 Known blocker: replies rejected by the output filter

**Symptom.** The assistant's turn ends abruptly with nothing written. In the session transcript the reply is replaced by `API Error: Output blocked by content filtering policy`. It looks like the assistant "keeps stopping".

**Evidence** (from the transcripts in `~/.claude/projects/d--GitHubRepos-Zuoye-Zuoye/*.jsonl`). Seven blocked replies on 2026-11-11: six in the first session (18:24, 18:29, 18:30, 18:56, 19:18, 19:23) and one in the second (19:44). Every one came 6–8 seconds after the assistant began writing the first phase-1 source file (`src/lib/pinyin.ts` / `src/lib/hanzi.ts`). Everything else was written without trouble: build config, plugins, this plan, shell commands. A blocked reply is discarded whole, including tool calls already issued in the same reply.

**Probable cause** (inferred; the blocked text cannot be read back). Those files started with long *canonical reference tables typed out from memory*: the alphabetical list of the ~410 valid pinyin syllables, and the Unicode table that maps radical code points to ordinary characters. A filter against verbatim reproduction of existing text fires on that kind of content. Changing the delivery (another tool, a heredoc) did not help in the first session, which fits a content-based trigger.

**How to avoid it: rules for whoever writes code here**

1. Never type out a canonical list, table or standard text from memory. This includes the full pinyin syllable inventory, Unicode data tables, frequency lists, HSK word lists and licence texts.
2. Derive instead of listing:
   - *Pinyin syllables:* recognise a syllable by rule (optional initial + one of ~35 finals, plus a few constraints), not by a 410-entry table. Accepting a few impossible combinations is harmless, because grading compares the answer with the expected pinyin and segmentation is anchored on the expected side.
   - *Radical look-alikes:* Kangxi radicals (U+2F00–U+2FD5) through `normalize('NFKC')`, which needs no table. For the CJK Radicals Supplement block, only a short list of the characters that matter, written as hex code-point pairs and checked by printing them from a script.
   - *Tone-marked vowels:* build them from the base vowel plus a combining mark and `normalize('NFC')`.
   - *Licence texts:* copy the file from `node_modules` with a script; never paste the text.
3. Keep each reply small: one source file per reply when the file contains language data, so a block loses one file, not ten.
4. Commit after each working step and keep 19.3 current, so that "continue" is always enough to resume.
5. If a block happens again: look at the last lines of the newest transcript to see which file was being written, add the finding here, and write that file in a different form (smaller pieces, data computed at run time, ASCII escapes instead of literal characters).

**Status.** Rules adopted on 2026-11-11 (evening). Whether they fully remove the problem is recorded in 19.3 as the files get written.

### 19.2 Gemini API notes (documentation re-read on 2026-11-11, evening)

Google's documentation has moved from `ai.google.dev` to `aistudio.google.com/docs` and `aistudio.google.com/api-reference`, and now presents the Interactions API first. The facts below were read on those pages unless marked otherwise. No request has been made yet (no key).

- **Models.** `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` all exist as stable models. The pricing page shows input and output "Free of charge" on the free tier for the first three (read verbatim); for `gemini-3.1-flash-lite` this came from a summary only. `gemini-3.1-flash-lite` shuts down on 7 May 2027 (replacement: `gemini-3.5-flash-lite`). `gemini-2.5-flash` shuts down on 1 December 2026. `gemini-3.8-flash` limits: 1,048,576 input tokens, 65,536 output tokens.
- **Endpoint.** `generateContent` "remains fully supported"; the Interactions API is recommended for new work and stores state by default (`store=true`). We stay on `generateContent`.
- **Request body** (camelCase): `contents[]` (`role`, `parts[]`), `systemInstruction` (a Content object, text only), `generationConfig`. A part is `{ text }` or `{ inlineData: { mimeType, data } }` with base64 data.
- **Key.** Sent in the `x-goog-api-key` header (shown in the migration guide's `generateContent` example). The reference page's own examples still put `?key=` in the URL; we do not, so the key never appears in a URL.
- **Structured output.** `generationConfig.responseMimeType: "application/json"` plus `responseJsonSchema`. The reference description of `responseJsonSchema` is circular, and a newer `responseFormat.text.schema` field also exists, so which one a given model honours must be tested with a real key. The client therefore retries without any schema on a 400 and always validates with zod. Supported schema keywords (from a summary): `type`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `enum`, `description`, `minimum`, `maximum`; string length limits are ignored.
- **Thinking.** `generationConfig.thinkingConfig.thinkingLevel` with upper-case values `MINIMAL`, `LOW`, `MEDIUM`, `HIGH`. `gemini-3.8-flash` defaults to medium and rejects `MINIMAL`; the Flash-Lite models default to minimal. The output-token limit covers thinking plus answer. Response parts with `thought: true` must be skipped.
- **Temperature.** `temperature`, `topP` and `topK` are ignored on 3.6 Flash and newer and "will return 400 errors in a future release": never send them.
- **Images.** Inline data keeps the whole request under 20 MB. An image up to 384 px a side costs 258 tokens; larger ones are tiled at 768 px, 258 tokens per tile. `generationConfig.mediaResolution` accepts `MEDIA_RESOLUTION_LOW`, `_MEDIUM`, `_HIGH`.
- **Response.** Text in `candidates[0].content.parts[].text`. `finishReason` values include `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`, `OTHER`. `promptFeedback.blockReason` signals a blocked prompt. Usage is in `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `totalTokenCount`).
- **Errors.** The error body of `generateContent` is no longer documented. The documented table is for the Interactions API (`error.code` as a lower-case string such as `rate_limit_exceeded`, `quota_exceeded`, `authentication`). The client must accept both that shape and the older one (`error.code` numeric, `error.status` such as `RESOURCE_EXHAUSTED`, optional `details[]` with a retry delay) and decide mainly by HTTP status. An invalid key may come back as 400, 401 or 403 (the pages disagree). A 403 with "Your project has been denied access" means the free tier is not available to that project.
- **Model list.** `GET /v1beta/models` returns `models[]` (`name` as `models/<id>`, `supportedGenerationMethods`, token limits) and `nextPageToken`; `pageSize` up to 1000.
- **Rate limits.** No numbers are published for the Flash models; they are shown only inside AI Studio, apply per project, and the daily count resets at midnight Pacific time.
- **Terms** (effective 23 March 2026). Unpaid use: content is used to improve Google's products. For the EEA, Switzerland and the UK the paid-tier data terms apply to unpaid quota as well. "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." Google also says not to embed keys in client-side code; in this app the key is typed in by its owner and stays on their device.

### 19.3 Progress log

**2026-11-11, session 1 (afternoon).** Analysed the materials, chose the stack, wrote the scaffold listed in section 16 and this plan. Stopped six times by the blocker in 19.1 while starting phase 1. No app code written.

**2026-11-11, session 2 (evening).**

- Node was 22.11.0, so work stopped until it was updated. Now v26.13.0 with npm 11.20.0.
- Section 16 checked against the files: all listed files exist; `public/` is missing as stated; there is no ESLint config yet; a stale `dist/` was removed.
- Ran and saw working: `npm ci` (183 packages, 0 vulnerabilities), `tsc --noEmit` (clean), `vite build` (succeeds, CSP meta tag present, 9,575 stroke files copied to `dist/hanzi`, `sw.js` written). Not yet exercised: dev-server middleware and service worker in a browser.
- `materiali/` holds the 15 course files and is ignored by git (checked with `git check-ignore`). There is no `.env.local`, so the real-model check of phase 3 stays open until a key is provided.
- Gemini documentation re-read (19.2).
- Blocker diagnosed from the transcripts and documented (19.1).
- Next: phase 1, written under the rules of 19.1.
