import 'reflect-metadata';
import { RolesGuard } from '../platform/roles.guard';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import type { AuditLogService } from '../platform/audit-log.service';
import { AuditLogListRequestDto } from './dto/audit-log-list-request.dto';

describe('AuditLogController', () => {
  it('GET /audit-logs를 전역 인증 가드로 보호한다', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AuditLogController)).toBe(
      'audit-logs',
    );
    const handler: unknown = Object.getOwnPropertyDescriptor(
      AuditLogController.prototype,
      'list',
    )?.value;
    expect(typeof handler).toBe('function');
    if (typeof handler !== 'function') return;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
  });

  it('세션 행위자와 필터를 서비스에 전달한다', async () => {
    const list = jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    });
    const controller = new AuditLogController({
      list,
    } as unknown as AuditLogService);
    const query = Object.assign(new AuditLogListRequestDto(), {
      actor: 'synthetic-admin',
    });

    await controller.list(query);

    expect(list).toHaveBeenCalledWith({
      actor: 'synthetic-admin',
      page: 1,
      limit: 20,
    });
  });
});
