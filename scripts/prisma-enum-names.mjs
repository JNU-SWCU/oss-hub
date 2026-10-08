import { readFileSync } from 'node:fs';

export function parsePrismaEnumNames(schema) {
  const declarations = schema.replace(
    /"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    ' ',
  );

  return Array.from(
    declarations.matchAll(/^\s*enum\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm),
    (match) => match[1],
  ).sort();
}

export const prismaEnumNames = parsePrismaEnumNames(
  readFileSync(
    new URL('../apps/backend/prisma/schema.prisma', import.meta.url),
    'utf8',
  ),
);
