import { Member } from './domain/member';
import { MembersErrorCode } from './members-error-code.enum';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';

describe('MembersService', () => {
  const member: Member = {
    id: 'member-1',
    email: 'member@example.com',
    nickname: '회원',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  let repository: jest.Mocked<Pick<MembersRepository, 'findById'>>;
  let service: MembersService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
    };
    service = new MembersService(repository as unknown as MembersRepository);
  });

  it('회원을 반환한다', async () => {
    repository.findById.mockResolvedValue(member);

    await expect(service.getMember(member.id)).resolves.toEqual(member);
    expect(repository.findById).toHaveBeenCalledWith(member.id);
  });

  it('없는 회원이면 MEM_001 예외를 던진다', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.getMember('missing-member')).rejects.toMatchObject({
      errorCode: {
        code: MembersErrorCode.MEMBER_NOT_FOUND,
        status: 404,
      },
    });
  });
});
