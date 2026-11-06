import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogReadService } from '../platform/audit-log-read.service';
import { AuditLogListRequestDto } from './dto/audit-log-list-request.dto';
import { AuditLogPageResponseDto } from './dto/audit-log-page-response.dto';
import { Protected } from '../auth/auth-route.decorator';
import { ADMIN_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from '../platform/history.error';

const adminOnly = () =>
  new DomainException(AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.ADMIN_ONLY]);

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogReadService) {}

  @Get()
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminOnly)
  async list(
    @Query() query: AuditLogListRequestDto,
  ): Promise<AuditLogPageResponseDto> {
    return AuditLogPageResponseDto.from(
      await this.service.listFromRequest(query),
    );
  }
}
