import { SubmissionFileRulesService } from '../programs/submission-file-rules.service';

const submissionFileRulesService = new SubmissionFileRulesService();

describe('add-one-calendar-year', () => {
  describe('addOneCalendarYear', () => {
    it('preserves the UTC calendar position across an ordinary year', () => {
      expect(
        submissionFileRulesService.addOneCalendarYear(
          new Date('2027-01-01T09:30:00.000Z'),
        ),
      ).toEqual(new Date('2028-01-01T09:30:00.000Z'));
    });

    it('clamps leap day to the final day of February', () => {
      expect(
        submissionFileRulesService.addOneCalendarYear(
          new Date('2028-02-29T00:00:00.000Z'),
        ),
      ).toEqual(new Date('2029-02-28T00:00:00.000Z'));
    });

    it('does not mutate the source date', () => {
      const source = new Date('2027-12-31T23:59:59.000Z');

      submissionFileRulesService.addOneCalendarYear(source);

      expect(source).toEqual(new Date('2027-12-31T23:59:59.000Z'));
    });
  });
});

describe('multipart-file-name', () => {
  describe('normalizeMultipartFileName', () => {
    it('restores a UTF-8 filename that the multipart parser exposed as latin1', () => {
      const mojibake = Buffer.from('제출-양식.pdf', 'utf8').toString('latin1');

      expect(
        submissionFileRulesService.normalizeMultipartFileName(mojibake),
      ).toBe('제출-양식.pdf');
    });

    it('keeps ASCII and already-decoded Unicode filenames unchanged', () => {
      expect(
        submissionFileRulesService.normalizeMultipartFileName('report.pdf'),
      ).toBe('report.pdf');
      expect(
        submissionFileRulesService.normalizeMultipartFileName('계획서.pdf'),
      ).toBe('계획서.pdf');
    });

    it('does not replace a raw latin1 filename with invalid UTF-8', () => {
      expect(
        submissionFileRulesService.normalizeMultipartFileName('résumé.pdf'),
      ).toBe('résumé.pdf');
    });
  });
});
