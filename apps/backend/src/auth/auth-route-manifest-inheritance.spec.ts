import {
  Controller,
  Get,
  type INestApplication,
  Module,
  RequestMethod,
  type Type,
  UseGuards,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { PathsExplorer } from '@nestjs/core/router/paths-explorer';
import { Test } from '@nestjs/testing';
import { discoverModuleControllers } from '../app-controller-discovery';
import { compareStringsByCodeUnit } from '../deterministic-string-order';
import {
  OptionalSession,
  Protected,
  Public,
  PUBLIC_ROUTE_METADATA,
} from './auth-route-metadata';
import { createAuthRouteManifest } from './auth-route-manifest';
import { SessionGuard } from './session.guard';

@Public()
@Controller()
class InheritedRouteBaseController {
  @Get('inherited')
  inherited(): string {
    return 'inherited';
  }
}

class InheritedRouteController extends InheritedRouteBaseController {}

@Public()
@Controller('override')
class OverriddenRouteBaseController {
  @Get('base')
  route(): string {
    return 'base';
  }
}

class OverriddenRouteController extends OverriddenRouteBaseController {
  @Get('derived')
  @OptionalSession()
  override route(): string {
    return 'derived';
  }
}

@Controller('invalid-inherited-class')
class InvalidInheritedClassBaseController {
  @Get()
  @Protected()
  route(): void {}
}
Reflect.defineMetadata(
  PUBLIC_ROUTE_METADATA,
  'invalid',
  InvalidInheritedClassBaseController,
);
class InvalidInheritedClassController extends InvalidInheritedClassBaseController {}

@Public()
@OptionalSession()
@Controller('duplicate-inherited-class')
class DuplicateInheritedClassBaseController {
  @Get()
  @Protected()
  route(): void {}
}
class DuplicateInheritedClassController extends DuplicateInheritedClassBaseController {}

@Controller('invalid-inherited-handler')
class InvalidInheritedHandlerBaseController {
  @Get()
  route(): void {}
}
const invalidInheritedHandler: unknown = Reflect.get(
  InvalidInheritedHandlerBaseController.prototype,
  'route',
);
if (typeof invalidInheritedHandler !== 'function') {
  throw new Error('Synthetic inherited handler must be a function');
}
Reflect.defineMetadata(
  PUBLIC_ROUTE_METADATA,
  'invalid',
  invalidInheritedHandler,
);
class InvalidInheritedHandlerController extends InvalidInheritedHandlerBaseController {}

@Controller('duplicate-inherited-handler')
class DuplicateInheritedHandlerBaseController {
  @Get()
  @Public()
  @OptionalSession()
  route(): void {}
}
class DuplicateInheritedHandlerController extends DuplicateInheritedHandlerBaseController {}

@Public()
@Controller('inherited-guard-conflict')
@UseGuards(SessionGuard)
class InheritedGuardConflictBaseController {
  @Get()
  route(): void {}
}
class InheritedGuardConflictController extends InheritedGuardConflictBaseController {}

@Controller('inherited-handler-guard-conflict')
class InheritedHandlerGuardConflictBaseController {
  @Get()
  @Public()
  @UseGuards(SessionGuard)
  route(): void {}
}
class InheritedHandlerGuardConflictController extends InheritedHandlerGuardConflictBaseController {}

@Public()
@Controller('Z')
class ZController {
  @Get()
  route(): void {}
}

@Public()
@Controller('Å')
class ÅController {
  @Get()
  route(): void {}
}

@Module({ controllers: [ÅController, ZController] })
class DeterministicOrderModule {}

function runtimeRouteKeys(
  controllers: readonly Type<unknown>[],
): readonly string[] {
  const pathsExplorer = new PathsExplorer(new MetadataScanner());

  const routeKeys = controllers.flatMap((controller) => {
    const prototypeValue: unknown = controller.prototype;
    if (typeof prototypeValue !== 'object' || prototypeValue === null) {
      throw new Error('Synthetic controller prototype must be an object');
    }
    const prototype = prototypeValue;
    const controllerPath: unknown = Reflect.getMetadata(
      PATH_METADATA,
      controller,
    );
    if (typeof controllerPath !== 'string') {
      throw new Error('Synthetic controller path must be a string');
    }

    return pathsExplorer.scanForPaths(prototype, prototype).flatMap((route) =>
      route.path.map((path) => {
        const joinedPath = ['api/v1', controllerPath, path]
          .flatMap((segment) => segment.split('/'))
          .filter(Boolean)
          .join('/');
        return `${RequestMethod[route.requestMethod]} /${joinedPath}`;
      }),
    );
  });

  return routeKeys.sort(compareStringsByCodeUnit);
}

describe('authentication route manifest inheritance', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InheritedRouteController],
    }).compile();
    application = moduleRef.createNestApplication();
    await application.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await application.close();
  });

  it('reconciles inherited and overridden handlers with Nest runtime routes', async () => {
    const controllers = [InheritedRouteController, OverriddenRouteController];
    const manifest = createAuthRouteManifest(controllers);

    await expect(
      fetch(`${await application.getUrl()}/inherited`),
    ).resolves.toMatchObject({ status: 200 });
    expect(manifest).toEqual([
      { access: 'PUBLIC', method: 'GET', path: '/api/v1/inherited' },
      {
        access: 'OPTIONAL_SESSION',
        method: 'GET',
        path: '/api/v1/override/derived',
      },
    ]);
    expect(manifest.map(({ method, path }) => `${method} ${path}`)).toEqual(
      runtimeRouteKeys(controllers),
    );
  });

  it('rejects invalid or duplicate inherited metadata', () => {
    expect(() =>
      createAuthRouteManifest([InvalidInheritedClassController]),
    ).toThrow(/invalid authentication metadata.*class/i);
    expect(() =>
      createAuthRouteManifest([DuplicateInheritedClassController]),
    ).toThrow(/duplicate authentication metadata.*class/i);
    expect(() =>
      createAuthRouteManifest([InvalidInheritedHandlerController]),
    ).toThrow(/invalid authentication metadata.*handler/i);
    expect(() =>
      createAuthRouteManifest([DuplicateInheritedHandlerController]),
    ).toThrow(/duplicate authentication metadata.*handler/i);
  });

  it('rejects inherited SessionGuard conflicts', () => {
    expect(() =>
      createAuthRouteManifest([InheritedGuardConflictController]),
    ).toThrow(/conflicting authentication metadata.*sessionguard/i);
    expect(() =>
      createAuthRouteManifest([InheritedHandlerGuardConflictController]),
    ).toThrow(/conflicting authentication metadata.*sessionguard/i);
  });

  it('orders controllers and routes without locale-sensitive comparison', () => {
    const localeCompare = jest
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error('locale-sensitive comparison used');
      });

    try {
      expect(discoverModuleControllers(DeterministicOrderModule)).toEqual([
        ZController,
        ÅController,
      ]);
      expect(createAuthRouteManifest([ÅController, ZController])).toEqual([
        { access: 'PUBLIC', method: 'GET', path: '/api/v1/Z' },
        { access: 'PUBLIC', method: 'GET', path: '/api/v1/Å' },
      ]);
    } finally {
      localeCompare.mockRestore();
    }
  });
});
