import { AuthRepository } from './auth.repository';
import { buildRow, prismaServiceWith } from './auth.repository.spec-support';

describe('AuthRepository raw principal projection', () => {
  it('returns stored approval rather than making an operational staff decision', async () => {
    const repository = new AuthRepository(
      prismaServiceWith({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              buildRow({ type: 'STAFF', approvalStatus: 'APPROVED' }),
            ),
        },
      }),
    );
    expect(await repository.findByGithubId(424242n)).toMatchObject({
      memberKind: 'STAFF',
      approvalStatus: 'APPROVED',
      profileCreatedAt: null,
    });
  });
  it('keeps student identity independent from an administrator grant', async () => {
    const repository = new AuthRepository(
      prismaServiceWith({
        user: {
          findUnique: jest.fn().mockResolvedValue(
            buildRow({
              type: 'STUDENT',
              admin: { userId: 'cuid-synthetic' },
              name: 'Student',
              studentId: '801030',
              department: 'Department',
              profileCreatedAt: new Date('2026-01-01'),
            }),
          ),
        },
      }),
    );
    expect(await repository.findByGithubId(424242n)).toMatchObject({
      memberKind: 'STUDENT',
      approvalStatus: 'NOT_REQUIRED',
      hasAdminAccess: true,
    });
  });
});
