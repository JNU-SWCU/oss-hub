import { isRecord } from '@/lib/is-record';
import type { ProgramListItem, ProgramListPage } from './dto';

type PublicProgramListItem = Omit<
  ProgramListItem,
  'note' | 'viewerApplicationStatus'
>;

class PublicProgramListResponseError extends Error {
  constructor() {
    super('Invalid public program list response');
    this.name = 'PublicProgramListResponseError';
  }
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parsePublicItem(value: unknown): PublicProgramListItem {
  if (!isRecord(value)) throw new PublicProgramListResponseError();
  const {
    id,
    name,
    organizers,
    trackType,
    applicationStartAt,
    applicationEndAt,
    endAt,
    coverImageUrl,
  } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    !Array.isArray(organizers) ||
    !organizers.every(
      (organizer: unknown): organizer is string =>
        typeof organizer === 'string',
    ) ||
    (trackType !== null &&
      trackType !== 'CURRICULAR' &&
      trackType !== 'EXTRACURRICULAR') ||
    !isDate(applicationStartAt) ||
    !isDate(applicationEndAt) ||
    (endAt !== null && !isDate(endAt)) ||
    (coverImageUrl !== undefined &&
      coverImageUrl !== null &&
      typeof coverImageUrl !== 'string')
  ) {
    throw new PublicProgramListResponseError();
  }
  return {
    id,
    name,
    organizers,
    trackType,
    applicationStartAt,
    applicationEndAt,
    endAt,
    coverImageUrl,
  };
}

export function parsePublicProgramList(value: unknown): ProgramListPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.totalPages !== 'number' ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0
  ) {
    throw new PublicProgramListResponseError();
  }
  return {
    items: value.items.map(parsePublicItem),
    totalPages: value.totalPages,
  };
}
