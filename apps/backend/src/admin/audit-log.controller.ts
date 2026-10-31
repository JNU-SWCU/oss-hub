import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { AuditLogService } from '../platform/audit-log.service';
import { AuditLogListRequestDto } from './dto/audit-log-list-request.dto';
import { AuditLogPageResponseDto } from './dto/audit-log-page-response.dto';
import { Protected } from '../auth/authentication.guard';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @Protected()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AuditLogListRequestDto,
  ): Promise<AuditLogPageResponseDto> {
    return AuditLogPageResponseDto.from(
      await this.service.list(request.sessionGithubId, query.toQuery()),
    );
  }
}
