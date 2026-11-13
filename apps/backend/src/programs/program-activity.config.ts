export const ACTIVITY_GRANULARITIES = ['MONTH', 'YEAR'] as const;

export const STUDENT_GITHUB_IDS = `
  SELECT author."githubId"
  FROM "User" AS author
  WHERE author.type = 'STUDENT'::"UserType"
`;
