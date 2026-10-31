import type { Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../src/app.module';
import { AuthModule } from '../../src/auth/auth.module';
import { UsersModule } from '../../src/users/users.module';

function moduleImports(module: Type<unknown>): Type<unknown>[] {
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ??
    []) as unknown[];
  return imports.filter(
    (entry): entry is Type<unknown> =>
      typeof entry === 'function' &&
      Reflect.hasMetadata(MODULE_METADATA.IMPORTS, entry),
  );
}

function reachable(root: Type<unknown>): Set<Type<unknown>> {
  const seen = new Set<Type<unknown>>();
  const visit = (module: Type<unknown>): void => {
    for (const child of moduleImports(module)) {
      if (!seen.has(child)) {
        seen.add(child);
        visit(child);
      }
    }
  };
  visit(root);
  return seen;
}

function findCycle(root: Type<unknown>): string[] | null {
  const done = new Set<Type<unknown>>();
  const stack: Type<unknown>[] = [];
  const visit = (module: Type<unknown>): string[] | null => {
    const index = stack.indexOf(module);
    if (index >= 0) {
      return [...stack.slice(index), module].map(({ name }) => name);
    }
    if (done.has(module)) {
      return null;
    }
    stack.push(module);
    for (const child of moduleImports(module)) {
      const cycle = visit(child);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    done.add(module);
    return null;
  };
  return visit(root);
}

describe('Nest module graph', () => {
  it('has no import cycle from AppModule', () => {
    expect(findCycle(AppModule)).toBeNull();
  });

  it('lets auth depend on users without users reaching auth', () => {
    expect(moduleImports(AuthModule)).toContain(UsersModule);
    expect(reachable(UsersModule).has(AuthModule)).toBe(false);
  });
});
