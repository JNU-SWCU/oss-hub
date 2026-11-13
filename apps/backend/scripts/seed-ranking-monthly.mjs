import { PrismaClient } from '@prisma/client';

const USAGE =
  'GITHUB_TOKEN=... DATABASE_URL=... node scripts/seed-ranking-monthly.mjs <year> [--apply]';
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const FIELDS =
  'totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions';

const seoulMonthStart = (year, month) =>
  new Date(Date.UTC(year, month - 1, 1) - SEOUL_OFFSET_MS);

function completedMonths(year, now) {
  const seoul = new Date(now.getTime() + SEOUL_OFFSET_MS);
  const last = seoul.getUTCFullYear() === year ? seoul.getUTCMonth() : 12;
  return Array.from({ length: Math.max(last, 0) }, (_, index) => index + 1);
}

async function fetchCumulative(login, year, months, token) {
  const from = seoulMonthStart(year, 1).toISOString();
  const aliases = months.map((month) => {
    const to = new Date(seoulMonthStart(year, month + 1).getTime() - 1);
    return `m${month}: contributionsCollection(from: "${from}", to: "${to.toISOString()}") { ${FIELDS} }`;
  });
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: { authorization: `bearer ${token}` },
    body: JSON.stringify({
      query: `query($login: String!) { user(login: $login) { ${aliases.join(' ')} } }`,
      variables: { login },
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.data?.user) {
    throw new Error(`GitHub query failed for ${login}: ${response.status}`);
  }
  return body.data.user;
}

async function main() {
  const [yearArg, ...flags] = process.argv.slice(2);
  const year = Number(yearArg);
  const token = process.env.GITHUB_TOKEN;
  if (!Number.isInteger(year) || !token) throw new Error(USAGE);
  const apply = flags.includes('--apply');
  const months = completedMonths(year, new Date());
  const prisma = new PrismaClient();
  let failed = 0;
  const rows = [];
  try {
    const observed = await prisma.$queryRaw`
      SELECT DISTINCT ON (observation.github_id)
        observation.github_id AS "githubId",
        account.login AS "githubLogin",
        observation.star_count AS "starCount"
      FROM github_user_activity_history AS observation
      JOIN "User" AS account
        ON account."githubId" = observation.github_id
      WHERE observation.year = ${year}
        AND observation.visibility = 'PUBLIC'::"ActivityVisibility"
        AND account.login IS NOT NULL
      ORDER BY observation.github_id, observation.observed_at DESC
    `;
    for (const user of observed) {
      try {
        const cumulative = await fetchCumulative(
          user.githubLogin,
          year,
          months,
          token,
        );
        for (const month of months) {
          const counts = cumulative[`m${month}`];
          rows.push({
            githubId: user.githubId,
            year,
            month,
            commitCount: counts.totalCommitContributions,
            pullRequestCount: counts.totalPullRequestContributions,
            issueCount: counts.totalIssueContributions,
            repositoryCount: counts.totalRepositoryContributions,
            starCount: user.starCount,
            observedAt: new Date(
              seoulMonthStart(year, month + 1).getTime() - 1,
            ),
          });
        }
      } catch (error) {
        failed += 1;
        console.error(String(error));
      }
    }
    const written = apply
      ? (
          await prisma.githubUserActivityMonthly.createMany({
            data: rows,
            skipDuplicates: true,
          })
        ).count
      : 0;
    console.log(
      JSON.stringify({
        apply,
        users: observed.length,
        failed,
        rows: rows.length,
        written,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
  if (failed > 0) process.exitCode = 1;
}

await main();
