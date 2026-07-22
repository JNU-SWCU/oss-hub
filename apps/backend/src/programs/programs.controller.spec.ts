import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProgramsController } from './programs.controller';

function readGuards(methodName: 'list' | 'create'): readonly unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    ProgramsController.prototype,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('ProgramsController authorization contract', () => {
  it('keeps the program list public for anonymous and inactive visitors', () => {
    expect(readGuards('list')).toEqual([]);
  });

  it('keeps program creation behind the shared session and origin guards', () => {
    expect(readGuards('create')).toEqual([SessionGuard, OriginGuard]);
  });
});
