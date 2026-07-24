import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { AuditLogController } from './audit-log.controller';
import type { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  it('GET /audit-logs를 SessionGuard로 보호한다', () => {
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
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      SessionGuard,
    ]);
  });

  it('세션 행위자와 필터를 서비스에 전달한다', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const controller = new AuditLogController({
      list,
    } as unknown as AuditLogService);
    const query = { actor: 'synthetic-admin' };

    await controller.list(
      { sessionGithubId: 1001n } as Parameters<AuditLogController['list']>[0],
      query,
    );

    expect(list).toHaveBeenCalledWith(1001n, query);
  });
});
