import { AccountStatus } from '@prisma/client';
import { ProgramNoticePreviewService } from './program-notice-preview.service';
const source = 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document';
const html =
  '<div class="kboard-title"><h1>Synthetic</h1></div><div class="kboard-content"><div class="content-view"><p>First</p><p>Second</p></div></div>';
const actor = {
  id: 'staff-synthetic',
  accountStatus: AccountStatus.ACTIVE,
  hasStaffAccess: true,
  hasAdminAccess: false,
};
function setup() {
  const findActor = jest.fn(() => Promise.resolve(actor));
  const read = jest.fn(() => Promise.resolve(html));
  return {
    service: new ProgramNoticePreviewService({ findActor }, { read }),
    findActor,
    read,
  };
}

it('returns clean editable candidates for an active staff member without persistence', async () => {
  const { service } = setup();
  expect(await service.preview(1n, source)).toEqual({
    sourceUrl: source,
    name: 'Synthetic',
    description: 'First\nSecond',
    coverImages: [],
    warnings: ['NO_IMAGE'],
  });
});

it.each([
  { ...actor, hasStaffAccess: false },
  { ...actor, accountStatus: AccountStatus.DEACTIVATED },
])('rejects an unauthorized actor before fetching: %j', async (value) => {
  const read = jest.fn(() => Promise.resolve(html));
  const service = new ProgramNoticePreviewService(
    { findActor: () => Promise.resolve(value) },
    { read },
  );
  await expect(service.preview(1n, source)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('rejects a missing actor before fetching', async () => {
  const read = jest.fn(() => Promise.resolve(html));
  const service = new ProgramNoticePreviewService(
    { findActor: () => Promise.resolve(null) },
    { read },
  );
  await expect(service.preview(1n, source)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('limits one actor to six requests in a rolling minute', async () => {
  const { service, read } = setup();
  for (let index = 0; index < 6; index++) await service.preview(1n, source);
  await expect(service.preview(1n, source)).rejects.toMatchObject({
    errorCode: { status: 429 },
  });
  expect(read).toHaveBeenCalledTimes(6);
});

it('limits concurrent upstream fetches to four and releases slots after completion', async () => {
  let finish: (html: string) => void = () => {
    throw new Error('not started');
  };
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const read = jest.fn(() => pending);
  const service = new ProgramNoticePreviewService(
    { findActor: () => Promise.resolve(actor) },
    { read },
  );
  const requests = [1, 2, 3, 4].map(() => service.preview(1n, source));
  await expect(service.preview(1n, source)).rejects.toMatchObject({
    errorCode: { status: 429 },
  });
  finish(html);
  await Promise.all(requests);
  await expect(service.preview(1n, source)).resolves.toMatchObject({
    name: 'Synthetic',
  });
});

it('limits all actors combined to sixty requests per rolling minute', async () => {
  const read = jest.fn(() => Promise.resolve(html));
  const service = new ProgramNoticePreviewService(
    { findActor: (id) => Promise.resolve({ ...actor, id: `staff-${id}` }) },
    { read },
  );
  for (let index = 0; index < 60; index++)
    await service.preview(BigInt(index), source);
  await expect(service.preview(61n, source)).rejects.toMatchObject({
    errorCode: { status: 429 },
  });
});
