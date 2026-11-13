# 作业 Zuòyè

A free, phone-first web app that turns the lessons of a Chinese course (PDF slides and Word homework) into written practice. Each lesson you add gives more to practise. The interface and all corrections are in Italian; characters are simplified.

Everything runs in the browser. There is no server, no account and no cost.

## What you can practise

| Exercise | Needs the model? |
|---|---|
| Write the pinyin of a word | No |
| Write the word in characters, stroke by stroke, with graded help | No |
| Translate Italian → Chinese | Yes, to correct free answers (works without it, by self-assessment) |
| Translate Chinese → Italian | Yes, same as above |
| Fill in the blank | No |
| Put the words in order | No |

What you get wrong comes back sooner; what you know comes back later (spaced repetition).

## Using it

1. **Open the app** at its address and add it to the Home screen of the phone ("Aggiungi a schermata Home" / "Installa app"). After the first visit it also works offline.
2. **Get a free Gemini key** in Google AI Studio, in a Google project **without billing**, and paste it in *Impostazioni*. With no billing on the project nothing can ever be charged: when the free quota ends, requests are refused.
3. **Add a lesson**: *Lezioni → Aggiungi una lezione*, pick the lesson's files (PDF, DOCX, photos, text), then check the extracted words before saving. Check the pinyin in particular: it is what you will learn.
4. **Practise** from *Esercizi*.
5. **Back up now and then**: *Impostazioni → Esporta un backup*. This is also how you move your data to another device.

To share a lesson with classmates, open it and choose *Esporta per i compagni*. They import the file from *Lezioni* and spend no quota.

There is also a small built-in sample lesson (*Lezioni → Carica la lezione di esempio*) for trying the exercises without a key.

## Privacy and cost

- Lessons and progress stay in the browser of your device (IndexedDB). Nothing is sent to any server of this app, because there is none.
- The key stays in the browser too and is sent only to Google, in a request header.
- Adding a lesson sends the text and page images of the files you chose to Gemini; correcting a translation sends that sentence and your answer. On Google's free tier this content may be used to improve their products, so do not upload documents with personal data.
- The app makes requests only to its own address and to `generativelanguage.googleapis.com`. A Content-Security-Policy enforces this.

## Development

Needs Node.js 22.12 or newer (24 LTS recommended).

```
npm ci
npm run dev        # development server
npm test           # unit tests
npm run typecheck
npm run lint
npm run build      # production build in dist/
npm run e2e        # drives the built app in a phone-sized browser; needs Edge (or E2E_BROWSER=chrome)
```

`npm run e2e` mocks the model, so it needs no key and sends nothing to Google. Screenshots go to `e2e-out/`.

The build is static and uses relative paths: the contents of `dist/` work on any static host, at a domain root or under a sub-path.

## Deployment

The app is published with GitHub Pages by the workflow in `.github/workflows/pages.yml`: every push to `main` runs the checks, builds, and publishes `dist/`. One-time setup on GitHub:

1. Make the repository public (*Settings → General → Danger Zone → Change repository visibility*). Free GitHub accounts can use Pages only on public repositories.
2. Turn Pages on (*Settings → Pages → Build and deployment → Source: GitHub Actions*).
3. Push `main`. When the *Deploy to GitHub Pages* workflow is green, the app is at `https://<user>.github.io/<repository>/`.

The repository holds only code. The published site is an empty app: lessons and key exist only in the browser of whoever uses it.

Course materials go in `materiali/`, which git ignores. They are never committed and never published.

[PLAN.md](PLAN.md) holds the design, the reasons behind it, and a diary of what was built, tested and left open.

## Credits and licences

- Stroke data: [Hanzi Writer](https://hanziwriter.org) and its data package, derived from the Make Me a Hanzi project and Arphic fonts, under the Arphic Public License. The licence text is published with the app at `hanzi/ARPHICPL.TXT`. The app icon is drawn from the same data.
- PDF reading: pdf.js (Apache License 2.0).
- Also: React, zod, idb, fflate (MIT).
