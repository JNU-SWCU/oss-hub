import { Injectable } from '@nestjs/common';
import {
  PROGRAM_ORGANIZER_MAX_LENGTH,
  PROGRAM_ORGANIZERS_ERROR_MESSAGES,
  PROGRAM_ORGANIZERS_MAX_COUNT,
  type ProgramOrganizersErrorCode,
  type ProgramOrganizersFieldError,
} from './program-organizers.config';

@Injectable()
export class ProgramOrganizersService {
  normalize(values: readonly string[]): {
    readonly organizers: string[];
    readonly error: ProgramOrganizersFieldError | null;
  } {
    const organizers = [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    const code: ProgramOrganizersErrorCode | null =
      organizers.length === 0
        ? 'REQUIRED'
        : organizers.length > PROGRAM_ORGANIZERS_MAX_COUNT
          ? 'TOO_MANY'
          : organizers.some(
                (organizer) => organizer.length > PROGRAM_ORGANIZER_MAX_LENGTH,
              )
            ? 'TOO_LONG'
            : null;
    return {
      organizers,
      error:
        code === null
          ? null
          : {
              field: 'organizers',
              code,
              message: PROGRAM_ORGANIZERS_ERROR_MESSAGES[code],
            },
    };
  }
}
