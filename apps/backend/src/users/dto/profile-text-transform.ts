import { ValidateBy } from 'class-validator';
import { normalizeProfileText } from '../domain/user-profile';

export function transformProfileText({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeProfileText(value) : value;
}

export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function IsProfileText(
  name: string,
  isValid: (value: string) => boolean,
): PropertyDecorator {
  return ValidateBy({
    name,
    validator: {
      validate(value: unknown): boolean {
        return typeof value === 'string' && isValid(value);
      },
    },
  });
}
