import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  MemberPageResponseDto,
  MemberResponseDto,
} from './dto/member-response.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get(':id')
  async getMember(@Param('id') id: string): Promise<MemberResponseDto> {
    const member = await this.membersService.getMember(id);
    return MemberResponseDto.from(member);
  }

  @Get()
  async getMembers(
    @Query() query: PaginationQueryDto,
  ): Promise<MemberPageResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const members = await this.membersService.getMembers(page, pageSize);

    return new MemberPageResponseDto(
      members.items,
      page,
      pageSize,
      members.total,
    );
  }
}
