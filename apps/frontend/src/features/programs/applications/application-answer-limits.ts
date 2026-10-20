export const APPLICATION_ANSWER_MAX_LENGTHS = { title: 200 } as const;

type ApplicationAnswerKey = keyof typeof APPLICATION_ANSWER_MAX_LENGTHS;

export function applicationAnswerMaxLength(key: string): number | undefined {
  return Object.hasOwn(APPLICATION_ANSWER_MAX_LENGTHS, key)
    ? APPLICATION_ANSWER_MAX_LENGTHS[key as ApplicationAnswerKey]
    : undefined;
}
