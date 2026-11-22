import { MailPreviewService } from './mail-preview.service';

const previews = new MailPreviewService();

it('preserves the existing JSON byte fingerprint', () => {
  expect(previews.version({ a: 1 })).toBe(
    '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
  );
  expect(previews.version({ a: 2 })).not.toBe(previews.version({ a: 1 }));
});

it('preserves inclusive legacy expiry without accepting future or invalid previews', () => {
  const previewedAt = new Date('2026-11-22T00:00:00.000Z');
  expect(
    previews.legacyIsCurrent(
      previewedAt,
      new Date(previewedAt.getTime() + 600_000),
      600_000,
    ),
  ).toBe(true);
  expect(
    previews.legacyIsCurrent(
      previewedAt,
      new Date(previewedAt.getTime() + 600_001),
      600_000,
    ),
  ).toBe(false);
  expect(
    previews.legacyIsCurrent(
      previewedAt,
      new Date(previewedAt.getTime() - 1),
      600_000,
    ),
  ).toBe(false);
  expect(
    previews.legacyIsCurrent(new Date('invalid'), previewedAt, 600_000),
  ).toBe(false);
});
