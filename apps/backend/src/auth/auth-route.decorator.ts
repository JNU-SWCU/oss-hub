import { SetMetadata } from '@nestjs/common';
import {
  OPTIONAL_SESSION_ROUTE_METADATA,
  PROTECTED_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
} from './authentication.guard';

type AuthRouteDecorator = ClassDecorator & MethodDecorator;

export function Public(): AuthRouteDecorator {
  return SetMetadata(PUBLIC_ROUTE_METADATA, true);
}

export function OptionalSession(): AuthRouteDecorator {
  return SetMetadata(OPTIONAL_SESSION_ROUTE_METADATA, true);
}

export function Protected(): AuthRouteDecorator {
  return SetMetadata(PROTECTED_ROUTE_METADATA, true);
}
