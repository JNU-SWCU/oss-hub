import { normalizeMultipartFileName } from './multipart-file-name';

describe('normalizeMultipartFileName', () => {
  it('restores a UTF-8 filename that the multipart parser exposed as latin1', () => {
    const mojibake = Buffer.from('제출-양식.pdf', 'utf8').toString('latin1');

    expect(normalizeMultipartFileName(mojibake)).toBe('제출-양식.pdf');
  });

  it('keeps ASCII and already-decoded Unicode filenames unchanged', () => {
    expect(normalizeMultipartFileName('report.pdf')).toBe('report.pdf');
    expect(normalizeMultipartFileName('계획서.pdf')).toBe('계획서.pdf');
  });

  it('does not replace a raw latin1 filename with invalid UTF-8', () => {
    expect(normalizeMultipartFileName('résumé.pdf')).toBe('résumé.pdf');
  });
});
