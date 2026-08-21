import { type Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';

export function discoverAppModuleControllers(): Type<unknown>[] {
  return discoverModuleControllers(AppModule);
}

export function discoverModuleControllers(
  rootModule: Type<unknown>,
): Type<unknown>[] {
  const controllers = new Set<Type<unknown>>();
  const visitedModuleTypes = new Set<Type<unknown>>();
  const visitedDynamicModules = new Set<object>();
  const visitedForwardReferences = new Set<object>();

  function addControllers(value: unknown, location: string): void {
    if (value === undefined) {
      return;
    }
    if (!Array.isArray(value)) {
      throw unsupportedImport(location, 'controllers metadata is not an array');
    }
    for (const [index, controller] of value.entries()) {
      if (typeof controller !== 'function') {
        throw unsupportedImport(
          `${location}[${index}]`,
          'controller is not a class',
        );
      }
      controllers.add(controller as Type<unknown>);
    }
  }

  function visitImports(value: unknown, location: string): void {
    if (value === undefined) {
      return;
    }
    if (!Array.isArray(value)) {
      throw unsupportedImport(location, 'imports metadata is not an array');
    }
    for (const [index, imported] of value.entries()) {
      visitImport(imported, `${location}[${index}]`);
    }
  }

  function visitModuleType(moduleType: Type<unknown>, location: string): void {
    if (visitedModuleTypes.has(moduleType)) {
      return;
    }
    visitedModuleTypes.add(moduleType);
    addControllers(
      Reflect.getOwnMetadata(MODULE_METADATA.CONTROLLERS, moduleType),
      `${location}.controllers`,
    );
    visitImports(
      Reflect.getOwnMetadata(MODULE_METADATA.IMPORTS, moduleType),
      `${location}.imports`,
    );
  }

  function visitImport(imported: unknown, location: string): void {
    if (typeof imported === 'function') {
      visitModuleType(imported as Type<unknown>, location);
      return;
    }
    if (isPromise(imported)) {
      throw unsupportedImport(
        location,
        'Promise imports cannot be discovered synchronously',
      );
    }
    if (!isRecord(imported)) {
      throw unsupportedImport(location, 'expected a module class or object');
    }

    const hasForwardReference = 'forwardRef' in imported;
    const hasDynamicModule = 'module' in imported;
    if (hasForwardReference === hasDynamicModule) {
      throw unsupportedImport(
        location,
        'expected exactly one of forwardRef or module',
      );
    }

    if (hasForwardReference) {
      if (visitedForwardReferences.has(imported)) {
        return;
      }
      visitedForwardReferences.add(imported);
      if (typeof imported.forwardRef !== 'function') {
        throw unsupportedImport(location, 'forwardRef is not a function');
      }
      const resolveForwardReference = imported.forwardRef as () => unknown;
      visitImport(resolveForwardReference(), `${location}.forwardRef()`);
      return;
    }

    if (visitedDynamicModules.has(imported)) {
      return;
    }
    visitedDynamicModules.add(imported);
    if (typeof imported.module !== 'function') {
      throw unsupportedImport(location, 'dynamic module has no module class');
    }
    visitModuleType(imported.module as Type<unknown>, `${location}.module`);
    addControllers(imported.controllers, `${location}.controllers`);
    visitImports(imported.imports, `${location}.imports`);
  }

  visitModuleType(rootModule, rootModule.name || 'RootModule');
  return [...controllers].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function unsupportedImport(location: string, reason: string): Error {
  return new Error(`Unsupported Nest module import at ${location}: ${reason}`);
}
