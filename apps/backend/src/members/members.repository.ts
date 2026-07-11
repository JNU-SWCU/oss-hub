import { Injectable } from '@nestjs/common';
import { Member as PrismaMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Member, MemberPage } from './domain/member';

@Injectable()
export class MembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Member | null> {
    const member = await this.prisma.member.findUnique({ where: { id } });
    return member ? this.toDomain(member) : null;
  }

  async findPage(page: number, pageSize: number): Promise<MemberPage> {
    const skip = (page - 1) * pageSize;
    const [members, total] = await this.prisma.$transaction([
      this.prisma.member.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.member.count(),
    ]);

    return {
      items: members.map((member) => this.toDomain(member)),
      total,
    };
  }

  private toDomain(member: PrismaMember): Member {
    return {
      id: member.id,
      email: member.email,
      nickname: member.nickname,
      createdAt: member.createdAt,
    };
  }
}
