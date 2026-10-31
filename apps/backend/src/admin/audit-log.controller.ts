import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from '../platform/audit-log.service';
import { AuditLogListRequestDto } from './dto/audit-log-list-request.dto';
import { AuditLogPageResponseDto } from './dto/audit-log-page-response.dto';
import { Protected } from '../auth/authentication.guard';
import { ADMIN_AUDIENCE, Roles } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from '../platform/audit-log-error-code.error';

const adminOnly = () =>
  new DomainException(AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.ADMIN_ONLY]);

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @Protected()
  @Roles(ADMIN_AUDIENCE, adminOnly)
  async list(
    @Query() query: AuditLogListRequestDto,
  ): Promise<AuditLogPageResponseDto> {
    return AuditLogPageResponseDto.from(
      await this.service.list(query.toQuery()),
    );
  }
}
