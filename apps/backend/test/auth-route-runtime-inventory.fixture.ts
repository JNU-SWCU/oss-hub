import { RequestMethod, type Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ApplicationConfig } from '@nestjs/core/application-config';
import { NestContainer } from '@nestjs/core/injector/container';
import { GraphInspector } from '@nestjs/core/inspector/graph-inspector';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { DependenciesScanner } from '@nestjs/core/scanner';
import { PathsExplorer } from '@nestjs/core/router/paths-explorer';
import { AppModule } from '../src/app.module';
import { compareStringsByCodeUnit } from '../src/deterministic-string-order';

export async function discoverRuntimeControllers(): Promise<Type<unknown>[]> {
  const applicationConfig = new ApplicationConfig();
  const container = new NestContainer(applicationConfig);
  const scanner = new DependenciesScanner(
    container,
    new MetadataScanner(),
    new GraphInspector(container),
    applicationConfig,
  );
  await scanner.scan(AppModule);

  return [...container.getModules().values()]
    .flatMap((module) => [...module.controllers.values()])
    .map((wrapper) => wrapper.metatype)
    .filter((controller): controller is Type<unknown> => Boolean(controller));
}

export function collectRuntimeRouteKeys(
  controllers: readonly Type<unknown>[],
): string[] {
  const pathsExplorer = new PathsExplorer(new MetadataScanner());

  return controllers
    .flatMap((controller) => {
      const prototypeValue: unknown = controller.prototype;
      if (typeof prototypeValue !== 'object' || prototypeValue === null) {
        throw new Error(`Invalid controller prototype: ${controller.name}`);
      }
      const pathMetadata: unknown = Reflect.getMetadata(
        PATH_METADATA,
        controller,
      );
      const controllerPaths: string[] = [];
      if (typeof pathMetadata === 'string') {
        controllerPaths.push(pathMetadata);
      } else if (Array.isArray(pathMetadata)) {
        for (const path of pathMetadata) {
          if (typeof path !== 'string') {
            throw new Error(
              `Invalid controller path metadata: ${controller.name}`,
            );
          }
          controllerPaths.push(path);
        }
      } else {
        throw new Error(`Invalid controller path metadata: ${controller.name}`);
      }

      return pathsExplorer
        .scanForPaths(prototypeValue, prototypeValue)
        .flatMap((route) =>
          controllerPaths.flatMap((controllerPath) =>
            route.path.map((handlerPath) => {
              const path = ['api/v1', controllerPath, handlerPath]
                .flatMap((segment) => segment.split('/'))
                .filter(Boolean)
                .join('/');
              return `${RequestMethod[route.requestMethod]} /${path}`;
            }),
          ),
        );
    })
    .sort(compareStringsByCodeUnit);
}
