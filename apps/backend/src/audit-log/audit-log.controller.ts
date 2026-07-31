import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AuditLogService, type AuditLogPage } from './audit-log.service';
import { AuditLogListRequestDto } from './dto/audit-log-query.dto';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @UseGuards(SessionGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AuditLogListRequestDto,
  ): Promise<AuditLogPage> {
    return this.service.list(request.sessionGithubId, query.toQuery());
  }
}
