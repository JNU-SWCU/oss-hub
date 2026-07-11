import { Member } from '../domain/member';

export class MemberResponseDto {
  id: string;
  email: string;
  nickname: string;
  createdAt: Date;

  private constructor(member: Member) {
    this.id = member.id;
    this.email = member.email;
    this.nickname = member.nickname;
    this.createdAt = member.createdAt;
  }

  static from(member: Member): MemberResponseDto {
    return new MemberResponseDto(member);
  }
}

export class MemberPageResponseDto {
  items: MemberResponseDto[];
  page: number;
  pageSize: number;
  total: number;

  constructor(
    members: Member[],
    page: number,
    pageSize: number,
    total: number,
  ) {
    this.items = members.map((member) => MemberResponseDto.from(member));
    this.page = page;
    this.pageSize = pageSize;
    this.total = total;
  }
}
