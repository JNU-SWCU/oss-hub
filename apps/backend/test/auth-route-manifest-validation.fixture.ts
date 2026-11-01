import {
  Controller,
  type DynamicModule,
  forwardRef,
  Get,
  Module,
} from '@nestjs/common';
import { PUBLIC_ROUTE_METADATA } from '../src/auth/authentication.guard';
import {
  OptionalSession,
  Protected,
  Public,
} from '../src/auth/auth-route.decorator';

@Controller('fixture/missing')
export class MissingMetadataController {
  @Get()
  get(): void {}
}

@Protected()
@Controller('fixture/duplicate')
export class DuplicateMetadataController {
  @Get()
  @Public()
  @OptionalSession()
  get(): void {}
}

@Public()
@OptionalSession()
@Controller('fixture/masked-class-duplicate')
export class MaskedClassDuplicateController {
  @Get()
  @Protected()
  get(): void {}
}

@Controller('fixture/masked-class-invalid')
export class MaskedClassInvalidController {
  @Get()
  @Protected()
  get(): void {}
}
Reflect.defineMetadata(
  PUBLIC_ROUTE_METADATA,
  'invalid-public-marker',
  MaskedClassInvalidController,
);

@Controller('fixture/dynamic')
export class DynamicController {}

@Module({ controllers: [DynamicController] })
class DynamicFeatureModule {}

@Module({ imports: [forwardRef(() => DynamicFeatureModule)] })
export class ForwardRefRootModule {}

const unsupportedImport = Promise.resolve({
  module: DynamicFeatureModule,
} satisfies DynamicModule);

@Module({ imports: [unsupportedImport] })
export class UnsupportedRootModule {}
