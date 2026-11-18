import { Test } from '@nestjs/testing';
import { ApplicationStatus, type Prisma } from '@prisma/client';
import { READ_CAP } from '../platform/bounded-read.config';
import { PrismaService } from '../platform/prisma.service';
import { ProgramMailRepository } from './program-mail.repository';

const findUnique = jest.fn<Promise<unknown>, [Prisma.ProgramFindUniqueArgs]>();

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue({
    id: 'program-1',
    name: '합성 프로그램',
    milestones: [{ requirements: [{ id: 'requirement-1' }] }],
    teams: [
      {
        id: 'team-1',
        name: '합성 팀',
        status: ApplicationStatus.REJECTED,
        applicant: {
          id: 'student-1',
          name: '학생 이름',
          nickname: 'student-login',
          notificationEmail: 'student@example.com',
          notifyEnabled: true,
          accountStatus: 'ACTIVE',
        },
        members: [],
        submissions: [],
      },
    ],
  });
});

it('reads every team status and nested applicant data in one bounded query', async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProgramMailRepository,
      {
        provide: PrismaService,
        useValue: { program: { findUnique } },
      },
    ],
  }).compile();
  const repository = moduleRef.get(ProgramMailRepository);

  const result = await repository.findAudience('program-1', {
    from: new Date('2026-11-18T00:00:00.000Z'),
    to: new Date('2026-11-19T00:00:00.000Z'),
  });

  expect(findUnique).toHaveBeenCalledTimes(1);
  const serializedQuery = JSON.stringify(findUnique.mock.calls[0]?.[0]);
  expect(serializedQuery).toContain(
    `"milestones":{"take":${READ_CAP.milestonesPerProgram + 1}`,
  );
  expect(serializedQuery).toContain(
    `"requirements":{"take":${READ_CAP.requirementsPerMilestone + 1}`,
  );
  expect(serializedQuery).toContain(
    `"teams":{"take":${READ_CAP.teamsPerProgram + 1}`,
  );
  expect(serializedQuery).toContain(
    `"members":{"take":${READ_CAP.membersPerTeam + 1}`,
  );
  expect(serializedQuery).toContain(
    `"submissions":{"take":${READ_CAP.requirementsPerProgram + 1}`,
  );
  expect(result?.teams[0]?.status).toBe(ApplicationStatus.REJECTED);
  expect(result?.teams[0]?.deadlineEligible).toBe(true);
  expect(result?.teams[0]?.applicants[0]?.id).toBe('student-1');
  expect(result?.teams[0]?.applicants[0]?.mailAvailable).toBe(true);
});
