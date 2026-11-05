import {
  prisma,
  prefix,
  now,
  leader,
  member,
  replacement,
  extra,
  staff,
  audit,
  service,
  invitations,
  invitationService,
  seedNamedStudents,
} from '../../test/application-nomination.fixture';
import { ApplicationsRepository } from './team.repository';
let sequence = 0;
let programId: string;
function apply(inviteeUserIds: readonly string[]) {
  const input = {
    teamName: 'Synthetic named team',
    answers: { title: 'Synthetic title' },
    applicationTemplateVersion: 1,
    isRepositoryPublicationPlanned: false,
    inviteeUserIds,
  };
  return service.create(
    9_100_001n,
    programId,
    service.createInputFromRequest(input),
    now,
  );
}
async function expectNoApplication() {
  expect(await prisma.team.count({ where: { programId } })).toBe(0);
  expect(await prisma.application.count({ where: { programId } })).toBe(0);
  expect(await prisma.teamInvitation.count({ where: { programId } })).toBe(0);
}
async function joinElsewhere(userId: string) {
  const team = await prisma.team.create({
    data: { programId, name: 'Synthetic other team', leaderId: userId },
  });
  await prisma.teamMember.create({
    data: { teamId: team.id, programId, userId },
  });
  return team.id;
}

describe('application named invitees integration', () => {
  beforeAll(seedNamedStudents);
  beforeEach(async () => {
    programId = prefix + ++sequence;
    await prisma.program.create({
      data: {
        id: programId,
        name: 'Synthetic program',
        organizer: 'Synthetic organizer',
        category: 'BASIC',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01'),
        applicationEndAt: new Date('2026-08-31'),
        startAt: new Date('2026-08-01'),
        endAt: new Date('2026-12-31'),
        teamMinSize: 2,
        teamMaxSize: 3,
        description: 'Synthetic fixture',
      },
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.teamInvitation.deleteMany({ where: { programId } });
    await prisma.application.deleteMany({ where: { programId } });
    await prisma.teamMember.deleteMany({ where: { programId } });
    await prisma.team.deleteMany({ where: { programId } });
    await prisma.program.delete({ where: { id: programId } });
    await prisma.user.updateMany({
      where: { id: { startsWith: prefix } },
      data: { accountStatus: 'ACTIVE' },
    });
  });
  afterAll(() => prisma.$disconnect());

  it('refuses solo application when minimum is two without creating rows', async () => {
    await expect(apply([])).rejects.toMatchObject({
      errorCode: { code: 'APP_019' },
    });
    await expectNoApplication();
  });

  it('rejects a named application when deletion commits after preflight and before apply-lock without creating rows', async () => {
    const findProgram = jest.spyOn(
      ApplicationsRepository.prototype,
      'findProgramById',
    );
    const readProgram = findProgram.getMockImplementation();
    if (readProgram === undefined)
      throw new Error('findProgramById spy has no original implementation');
    const auditCount = await prisma.auditLog.count();
    findProgram.mockImplementationOnce(async function (
      this: ApplicationsRepository,
      id: string,
    ) {
      const program = await readProgram.call(this, id);
      expect(program).not.toBeNull();
      await prisma.program.update({
        where: { id },
        data: { lifecycle: 'DELETED' },
      });
      return program;
    });

    await expect(apply([member])).rejects.toMatchObject({
      errorCode: { code: 'APP_009' },
    });
    await expect(
      prisma.program.findUnique({ where: { id: programId } }),
    ).resolves.toMatchObject({ lifecycle: 'DELETED' });
    await expectNoApplication();
    expect(await prisma.teamMember.count({ where: { programId } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditCount);
  });

  it('searches eligible registered students without needing a team', async () => {
    await prisma.user.update({
      where: { id: member },
      data: { accountStatus: 'DEACTIVATED' },
    });
    await joinElsewhere(extra);
    const candidates = await invitationService.searchApplicationCandidates(
      9_100_001n,
      programId,
      prefix,
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual([replacement]);
  });

  it('denies application candidate search to staff accounts', async () => {
    await expect(
      invitationService.searchApplicationCandidates(
        9_100_005n,
        programId,
        prefix,
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_008' } });
  });

  it('allows solo application when minimum is one', async () => {
    await prisma.program.update({
      where: { id: programId },
      data: { teamMinSize: 1 },
    });
    const application = await apply([]);
    expect(
      await prisma.teamMember.count({ where: { teamId: application.teamId } }),
    ).toBe(1);
    expect(await prisma.teamInvitation.count({ where: { programId } })).toBe(0);
  });

  it('accepts at least the minimum and creates only the leader membership plus pending invitations', async () => {
    const application = await apply([member, replacement]);
    expect(
      await prisma.teamMember.findMany({
        where: { teamId: application.teamId },
        select: { userId: true },
      }),
    ).toEqual([{ userId: leader }]);
    expect(
      await prisma.teamInvitation.findMany({
        where: { teamId: application.teamId },
        orderBy: { inviteeId: 'asc' },
        select: { inviteeId: true },
      }),
    ).toEqual([{ inviteeId: member }, { inviteeId: replacement }]);
    const pending = await prisma.teamInvitation.findMany({
      where: { teamId: application.teamId },
      select: { id: true, inviteeId: true },
    });
    for (const invitation of pending) {
      expect(
        await invitations.withAcceptTransaction(
          invitation.id,
          invitation.inviteeId,
          now,
        ),
      ).toMatchObject({ kind: 'ok' });
    }
    await expect(
      service.decide({ id: staff, githubId: 9_100_005n }, application.id, {
        action: 'APPROVE',
      }),
    ).resolves.toMatchObject({ kind: 'APPROVED' });
  });

  it.each([
    ['duplicate', [member, member], 'APP_032'],
    ['self', [leader], 'APP_032'],
    ['above maximum', [member, replacement, extra], 'APP_035'],
    ['staff account', [staff], 'APP_033'],
    ['missing account', [prefix + 'missing'], 'APP_033'],
  ] as const)('refuses %s named students atomically', async (_, ids, code) => {
    await expect(apply(ids)).rejects.toMatchObject({ errorCode: { code } });
    await expectNoApplication();
  });

  it('refuses an inactive named account', async () => {
    await prisma.user.update({
      where: { id: member },
      data: { accountStatus: 'DEACTIVATED' },
    });
    await expect(apply([member])).rejects.toMatchObject({
      errorCode: { code: 'APP_033' },
    });
    await expectNoApplication();
  });

  it('refuses a named student who already belongs to another team', async () => {
    await joinElsewhere(member);
    await expect(apply([member])).rejects.toMatchObject({
      errorCode: { code: 'APP_034' },
    });
    expect(await prisma.application.count({ where: { programId } })).toBe(0);
    expect(await prisma.teamInvitation.count({ where: { programId } })).toBe(0);
  });

  it('requires acceptance and allows replacing a declined invitee before approval', async () => {
    const application = await apply([member]);
    await expect(
      service.decide({ id: staff, githubId: 9_100_005n }, application.id, {
        action: 'APPROVE',
      }),
    ).rejects.toMatchObject({ errorCode: { code: 'APP_019' } });
    const pending = await prisma.teamInvitation.findFirstOrThrow({
      where: { teamId: application.teamId, inviteeId: member },
    });
    expect(
      await invitations.declinePendingInvitationAsInvitee(
        pending.id,
        member,
        now,
      ),
    ).toEqual({ kind: 'ok' });
    const invited = await invitations.createInvitation(
      { teamId: application.teamId, actorId: leader, inviteeId: replacement },
      now,
    );
    if (invited.kind !== 'ok')
      throw new Error(`Replacement invitation failed: ${invited.kind}`);
    expect(
      await invitations.withAcceptTransaction(
        invited.invitation.id,
        replacement,
        now,
      ),
    ).toMatchObject({ kind: 'ok' });
    await expect(
      service.decide({ id: staff, githubId: 9_100_005n }, application.id, {
        action: 'APPROVE',
      }),
    ).resolves.toMatchObject({ kind: 'APPROVED' });
    expect(
      await prisma.teamMember.findMany({
        where: { teamId: application.teamId },
        orderBy: { userId: 'asc' },
        select: { userId: true },
      }),
    ).toEqual([{ userId: leader }, { userId: replacement }]);
  });

  it('refuses acceptance when a named student joined elsewhere after application', async () => {
    const application = await apply([member]);
    const pending = await prisma.teamInvitation.findFirstOrThrow({
      where: { teamId: application.teamId, inviteeId: member },
    });
    await joinElsewhere(member);
    expect(
      await invitations.withAcceptTransaction(pending.id, member, now),
    ).toEqual({ kind: 'already-in-team' });
    expect(
      await prisma.teamMember.count({ where: { teamId: application.teamId } }),
    ).toBe(1);
  });

  it('rolls back the team, application and invitations when the final audit fails', async () => {
    jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('Synthetic audit failure'));
    await expect(apply([member])).rejects.toThrow('Synthetic audit failure');
    await expectNoApplication();
  });
});
