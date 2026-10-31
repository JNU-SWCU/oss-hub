import {
  Controller,
  type DynamicModule,
  forwardRef,
  Get,
  Module,
} from '@nestjs/common';
import {
  OptionalSession,
  Protected,
  Public,
  PUBLIC_ROUTE_METADATA,
} from '../src/auth/authentication.guard';

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
