/**
 * Reads the text of a Word document (.docx).
 *
 * A .docx is a zip; the text lives in word/document.xml. Only that entry is
 * unpacked, with a size limit, and it is walked tag by tag instead of being
 * parsed into a document: the result is plain text, never markup.
 */
import { strFromU8, unzipSync } from 'fflate';

const DOCUMENT = 'word/document.xml';
const MAX_XML_BYTES = 12_000_000;
const MAX_TEXT_CHARS = 200_000;
const BLANK = '____';

export class DocxError extends Error {}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name] ?? whole;
  });
}

/** Turns the XML of word/document.xml into plain text: one line per paragraph or table row. */
export function wordXmlToText(xml: string): string {
  const lines: string[] = [];
  let line = '';
  let inText = false;
  let underlined = false; // current run is underlined
  let cellDepth = 0;
  let skipDepth = 0; // inside a fallback copy of the same content
  const pushLine = () => {
    lines.push(line.replace(/[ \t]+$/g, ''));
    line = '';
  };

  const token = /<(\/?)([A-Za-z0-9_:.-]+)([^>]*)>|([^<]+)/g;
  for (let m = token.exec(xml); m !== null; m = token.exec(xml)) {
    if (m[4] !== undefined) {
      if (!inText || skipDepth > 0) continue;
      const text = decodeEntities(m[4]);
      // An underlined run of spaces is how a blank to fill in is usually typed.
      if (underlined && text.trim() === '') {
        if (!line.endsWith(BLANK)) line += BLANK;
      } else {
        line += text;
      }
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2]!;
    const attrs = m[3] ?? '';
    const selfClosing = attrs.endsWith('/');

    if (name === 'mc:Fallback') {
      if (!selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (skipDepth > 0) continue;

    switch (name) {
      case 'w:t':
        inText = !closing && !selfClosing;
        break;
      case 'w:r':
        underlined = false;
        break;
      case 'w:u':
        if (!closing) underlined = !/w:val="none"/.test(attrs);
        break;
      case 'w:tab':
        if (!closing) line += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (!closing) line += cellDepth > 0 ? ' ' : '\n';
        break;
      case 'w:noBreakHyphen':
        if (!closing) line += '-';
        break;
      case 'w:tc':
        if (selfClosing) break;
        if (closing) {
          cellDepth--;
          line = `${line.trimEnd()}\t`;
        } else {
          cellDepth++;
        }
        break;
      case 'w:tr':
        if (closing) pushLine();
        break;
      case 'w:p':
        if (!closing && !selfClosing) break;
        // Inside a table the row is the line; paragraphs in a cell are joined.
        if (cellDepth > 0) line += line === '' || /\s$/.test(line) ? '' : ' ';
        else pushLine();
        break;
      default:
        break;
    }
  }
  if (line.trim() !== '') pushLine();

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** The plain text of a .docx file. Throws DocxError when the file is not a readable Word document. */
export function docxToText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (file) => file.name === DOCUMENT && file.originalSize <= MAX_XML_BYTES });
  } catch {
    throw new DocxError('not a zip archive');
  }
  const xml = entries[DOCUMENT];
  if (!xml) throw new DocxError('no readable word/document.xml');
  return wordXmlToText(strFromU8(xml));
}
