import { ProgramCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

describe('ProgramEditorRepository updates', () => {
  it('persists team range when updating to a team category', async () => {
    const update = jest
      .fn<
        Promise<unknown>,
        [input: { data: { teamMinSize: number; teamMaxSize: number } }]
      >()
      .mockResolvedValue({
        id: 'program-1',
        name: 'OSS',
        organizer: 'Center',
        category: ProgramCategory.OSS_CONTEST,
        applicationTemplateKey: 'oss-contest',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
        teamMinSize: 2,
        teamMaxSize: 4,
        repositoryProvisioningEnabled: false,
        description: 'overview',
        _count: { applications: 0, teams: 0 },
        milestones: [],
      });
    const transaction = { program: { update } };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const repository = new ProgramEditorRepository(
      prisma as unknown as PrismaService,
    );

    await repository.withTransaction((store) =>
      store.updateProgram({
        programId: 'program-1',
        name: 'OSS',
        organizer: 'Center',
        category: ProgramCategory.OSS_CONTEST,
        applicationTemplateKey: 'oss-contest',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
        teamMinSize: 2,
        teamMaxSize: 4,
        repositoryProvisioningEnabled: false,
        description: 'overview',
      }),
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0].data).toMatchObject({
      teamMinSize: 2,
      teamMaxSize: 4,
    });
  });
});
