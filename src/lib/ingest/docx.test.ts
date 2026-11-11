import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DocxError, docxToText, wordXmlToText } from './docx.ts';

const p = (...runs: string[]) => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr>${runs.join('')}</w:p>`;
const r = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const doc = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}<w:sectPr/></w:body></w:document>`;

describe('wordXmlToText', () => {
  it('gives one line per paragraph and joins the runs of a paragraph', () => {
    const xml = doc(p(r('Traduci in '), r('cinese')) + p() + p(r('我是学生。')));
    expect(wordXmlToText(xml)).toBe('Traduci in cinese\n\n我是学生。');
  });

  it('decodes entities and keeps the text literal', () => {
    const xml = doc(p(r('Tom &amp; Li &lt;b&gt;ciao&lt;/b&gt; &#x4F60;&#22909; &quot;x&quot;')));
    expect(wordXmlToText(xml)).toBe('Tom & Li <b>ciao</b> 你好 "x"');
  });

  it('keeps tabs, line breaks and typed underscores', () => {
    const xml = doc(p(r('完'), '<w:r><w:tab/></w:r>', r('好'), '<w:r><w:br/></w:r>', r('我还没找_____我的手机。')));
    expect(wordXmlToText(xml)).toBe('完\t好\n我还没找_____我的手机。');
  });

  it('turns an underlined run of spaces into a blank', () => {
    const xml = doc(p(r('我'), r('      ', '<w:u w:val="single"/>'), r('   ', '<w:u w:val="single"/>'), r('喜欢茶。')));
    expect(wordXmlToText(xml)).toBe('我____喜欢茶。');
    const notUnderlined = doc(p(r('我'), r('   ', '<w:u w:val="none"/>'), r('喜欢茶。')));
    expect(wordXmlToText(notUnderlined)).toBe('我   喜欢茶。');
  });

  it('puts a table row on one line, cells separated by tabs', () => {
    const cell = (...paragraphs: string[]) => `<w:tc><w:tcPr/>${paragraphs.join('')}</w:tc>`;
    const xml = doc(
      `<w:tbl><w:tr>${cell(p(r('公交车')))}${cell(p(r('autobus')), p(r('mezzo')))}</w:tr><w:tr>${cell(p(r('地铁')))}${cell(p(r('metro')))}</w:tr></w:tbl>${p(r('fine'))}`,
    );
    expect(wordXmlToText(xml)).toBe('公交车\tautobus mezzo\n地铁\tmetro\nfine');
  });

  it('ignores deleted text, field codes and fallback copies', () => {
    const xml = doc(
      p(
        r('visibile'),
        '<w:del><w:r><w:delText>cancellato</w:delText></w:r></w:del>',
        '<w:r><w:instrText> PAGE </w:instrText></w:r>',
        `<mc:AlternateContent><mc:Choice>${r(' scelto')}</mc:Choice><mc:Fallback>${r(' copia')}</mc:Fallback></mc:AlternateContent>`,
      ),
    );
    expect(wordXmlToText(xml)).toBe('visibile scelto');
  });

  it('copes with malformed input without throwing', () => {
    expect(wordXmlToText('')).toBe('');
    expect(wordXmlToText('<w:p><w:r><w:t>aperto')).toBe('aperto');
    expect(wordXmlToText('testo senza tag')).toBe('');
  });
});

describe('docxToText', () => {
  it('reads the document entry of the archive', () => {
    const zip = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(doc(p(r('你好')))),
      'word/media/image1.png': new Uint8Array(2000),
    });
    expect(docxToText(zip)).toBe('你好');
  });

  it('refuses files that are not Word documents', () => {
    expect(() => docxToText(strToU8('%PDF-1.7 not a zip'))).toThrow(DocxError);
    expect(() => docxToText(zipSync({ 'other.txt': strToU8('x') }))).toThrow(DocxError);
  });

  it('refuses an oversized document entry instead of unpacking it', () => {
    const huge = zipSync({ 'word/document.xml': new Uint8Array(13_000_000) });
    expect(huge.length).toBeLessThan(200_000); // highly compressed: a small file hiding a big one
    expect(() => docxToText(huge)).toThrow(DocxError);
  });
});
