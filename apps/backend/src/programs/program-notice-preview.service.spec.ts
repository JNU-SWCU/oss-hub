import { createProgramNoticeFetchClient } from '../../test/program-notice-client.fixture';
import { ProgramNoticePreviewService } from './program-notice-preview.service';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';

it('shares the per-actor quota across listing and preview requests', async () => {
  const client = createProgramNoticeFetchClient();
  const read = jest
    .spyOn(client, 'read')
    .mockResolvedValue('<div class="kboard-list"><table></table></div>');
  const service = new ProgramNoticePreviewService(client);
  for (let index = 0; index < 6; index++) await service.list('staff');
  await expect(
    service.preview(
      'staff',
      'https://sojoong.kr/notice/notice-board/?uid=1&mod=document',
    ),
  ).rejects.toMatchObject({
    errorCode: { code: 'PROGRAM_NOTICE_RATE_LIMITED' },
  });
  expect(read).toHaveBeenCalledTimes(6);
  await expect(service.list('other-staff')).resolves.toEqual({ items: [] });
});

it('limits concurrent list requests and frees capacity after upstream failure', async () => {
  const client = createProgramNoticeFetchClient();
  let reject: ((error: Error) => void) | undefined;
  const pending = new Promise<string>((_resolve, fail) => {
    reject = fail;
  });
  const read = jest.spyOn(client, 'read').mockReturnValue(pending);
  const service = new ProgramNoticePreviewService(client);
  const active = Array.from({ length: 4 }, (_, index) =>
    service.list(`staff-${index}`),
  );
  const failures = active.map((request) =>
    expect(request).rejects.toThrow('unavailable'),
  );
  await expect(service.list('fifth')).rejects.toMatchObject({
    errorCode: { code: 'PROGRAM_NOTICE_RATE_LIMITED' },
  });
  reject?.(new Error('unavailable'));
  await Promise.all(failures);
  read.mockResolvedValue('<div class="kboard-list"></div>');
  await expect(service.list('two')).resolves.toEqual({ items: [] });
});

it('uses only allowlisted body posters to enrich real list entries and retains unavailable cards', async () => {
  const client = createProgramNoticeFetchClient();
  const row = (uid: number) =>
    `<tr><td><a href="/notice/notice-board/?uid=${uid}&amp;mod=document"><div class="custom-title">Notice ${uid}</div></a><span class="kboard-date">2026.11.17</span></td></tr>`;
  jest
    .spyOn(client, 'read')
    .mockResolvedValueOnce(
      `<div class="kboard-list"><table>${row(2)}${row(1)}</table></div>`,
    )
    .mockResolvedValueOnce(
      '<div class="kboard-title"><h1>Notice</h1></div><div class="kboard-content"><div class="content-view"><img src="https://evil.example/x.jpg"><img src="/wp-content/uploads/2026/11/poster.jpg"></div></div>',
    )
    .mockRejectedValueOnce(
      new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED),
    );
  const list = await new ProgramNoticePreviewService(client).list('staff');
  expect(list.items.map((item) => item.thumbnailUrl)).toEqual([
    'https://sojoong.kr/wp-content/uploads/2026/11/poster.jpg',
    null,
  ]);
});

it('stops reading posters once the overall list budget is exhausted', async () => {
  const client = createProgramNoticeFetchClient();
  const row = (uid: number) =>
    `<tr><td><a href="/notice/notice-board/?uid=${uid}&amp;mod=document"><div class="custom-title">Notice ${uid}</div></a><span class="kboard-date">2026.11.17</span></td></tr>`;
  const read = jest
    .spyOn(client, 'read')
    .mockResolvedValueOnce(
      `<div class="kboard-list"><table>${row(2)}${row(1)}</table></div>`,
    )
    .mockRejectedValueOnce(
      new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED),
    );
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(100)
    .mockReturnValue(8000);
  try {
    const list = await new ProgramNoticePreviewService(client).list('staff');
    expect(list.items.map((item) => item.thumbnailUrl)).toEqual([null, null]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[2]).toBe(7900);
  } finally {
    clock.mockRestore();
  }
});
