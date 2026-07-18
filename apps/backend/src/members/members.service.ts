import { Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { Member, MemberPage } from './domain/member';
import {
  MEMBER_ERROR_CODES,
  MembersErrorCode,
} from './members-error-code.enum';
import { MembersRepository } from './members.repository';

@Injectable()
export class MembersService {
  constructor(private readonly membersRepository: MembersRepository) {}

  async getMember(id: string): Promise<Member> {
    // 단일 조회 유스케이스의 트랜잭션 경계입니다.
    const member = await this.membersRepository.findById(id);

    if (!member) {
      throw new DomainException(
        MEMBER_ERROR_CODES[MembersErrorCode.MEMBER_NOT_FOUND],
      );
    }

    return member;
  }

  async getMembers(page: number, pageSize: number): Promise<MemberPage> {
    // 목록 조회 유스케이스의 트랜잭션 경계입니다.
    return this.membersRepository.findPage(page, pageSize);
  }
}
