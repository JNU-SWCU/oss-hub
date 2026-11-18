import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import type { ProgramMailSendRepository } from './program-mail-send.repository';
import type { ProgramMailWorkerService } from './program-mail-worker.service';

const input = {
  actorId: 'staff-1',
  programId: 'program-1',
  programName: 'OSS 프로그램',
  senderName: '운영자',
  subject: '안내',
  body: '본문',
  previewVersion: 'preview-1',
  occurredAt: new Date('2026-03-01T00:00:00.000Z'),
  recipients: [
    {
      id: 'user-1',
      displayName: '지원자',
      notificationEmail: 'member@example.com',
    },
  ],
} as const;

type Reserve = Pick<ProgramMailSendRepository, 'reserve'>['reserve'];
type Process = Pick<ProgramMailWorkerService, 'process'>['process'];

describe('ProgramMailDeliveryService', () => {
  it('commits the reservation before asking the worker to deliver', async () => {
    const reserve: jest.MockedFunction<Reserve> = jest.fn();
    reserve.mockResolvedValue({
      kind: 'OWNER',
      batchKey: 'program-mail-send:preview-1',
    });
    const process: jest.MockedFunction<Process> = jest.fn();
    process.mockResolvedValue({
      kind: 'COMPLETED',
      batchKey: 'program-mail-send:preview-1',
      result: {
        sentCount: 1,
        duplicateCount: 0,
        failedCount: 0,
        unknownCount: 0,
      },
    });
    const service = new ProgramMailDeliveryService({ reserve }, { process });

    await expect(service.send(input)).resolves.toMatchObject({
      kind: 'COMPLETED',
      result: { sentCount: 1 },
    });
    expect(reserve).toHaveBeenCalledTimes(1);
    const reserved = reserve.mock.calls[0]?.[0];
    expect(reserved?.actorId).toBe(input.actorId);
    expect(reserved?.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reserved?.bodyLength).toBe(input.body.length);
    expect(process).toHaveBeenCalledWith('program-mail-send:preview-1');
  });

  it('returns stored in-progress state without starting another worker', async () => {
    const reserve: jest.MockedFunction<Reserve> = jest.fn();
    reserve.mockResolvedValue({
      kind: 'IN_PROGRESS',
      batchKey: 'program-mail-send:preview-1',
    });
    const process: jest.MockedFunction<Process> = jest.fn();
    const service = new ProgramMailDeliveryService({ reserve }, { process });

    await expect(service.send(input)).resolves.toEqual({
      kind: 'IN_PROGRESS',
      batchKey: 'program-mail-send:preview-1',
    });
    expect(process).not.toHaveBeenCalled();
  });
});
