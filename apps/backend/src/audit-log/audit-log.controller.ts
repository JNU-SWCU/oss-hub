import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import type { AuditLogRecord } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogListRequestDto } from './dto/audit-log-query.dto';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @UseGuards(SessionGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AuditLogListRequestDto,
  ): Promise<readonly AuditLogRecord[]> {
    return this.service.list(request.sessionGithubId, query);
  }
}
