# ADR-003: Backend module structure, naming, and DTO conventions

## Context

The backend is split into 10 Nest modules and follows the [Nest defaults](https://docs.nestjs.com/modules). Only enforceable rules live here.

## Decision

### Module map

| Module | Scope |
| --- | --- |
| `auth` | Authentication, login history |
| `users` | Users, onboarding, role requests, consents |
| `programs` | Programs and public reads, board, team invitations, applications, submissions, submission reviews, milestone documents |
| `ranking` | Ranking |
| `student` | Student dashboard, my repositories |
| `staff` | Staff dashboard, insights, staff menu reads |
| `admin` | Admin user management, audit log reads, system status, collection admin |
| `notifications` | Notifications |
| `github` | Collection, repositories |
| `platform` | Prisma, runtime config, storage, health, common, audit log writes |

### Folders and files

- One folder is one Nest module, at depth 1. The only subfolder is `dto/`.
- A module's public API is the providers in its `exports`.
- File names are kebab-case: plural for resources, singular for concepts.
- A class is named PascalCase(stem) plus the suffix. The contract block below defines the suffixes and exempt files.
- Types live next to the code that produces them. `.types.ts` is only for types shared across modules.

### DTOs

- Request DTOs hold fields and class-validator decorators only. Inherit only when Create and Update match field for field, validators included.
- Response DTOs hold `declare readonly` fields and a `static from()` returning an object literal in the baseline JSON key order. Services compute derived values and pass them to `from()`.
- Absence is an explicit state field, never null.

```ts
export class ProgramSummaryResponseDto {
  declare readonly id: string;
  static from(p: Program) { return { id: p.id }; }
}
```

### Placement

- A read endpoint lives in the audience module (`student`, `staff`, `admin`) of the lowest-privilege menu that calls it. Writes stay in the module that owns the data.
- The direction is one write repository per aggregate.
- Frontend and backend never reference each other's paths.

### Removed rules

- File size rule: small files are no longer absorbed. A file holds one concept ([Angular style guide](https://angular.dev/style-guide)).
- Type-only file split: replaced by the `.types.ts` rule above.
- `.scheduler`, `.job`, and `.policy` roles: `@Cron`/`@Interval` are methods on module services ([task scheduling](https://docs.nestjs.com/techniques/task-scheduling)). CLI commands run through one `src/cli.ts` using `createApplicationContext` ([standalone applications](https://docs.nestjs.com/standalone-applications)). Domain-rule functions live in services or repositories.

## Consequences

The contract block's `rules` enforce the above as lint errors. Nested contexts, vertical slice, `@Expose` serialization, mapped-types, nestjs-zod, and nestia were not adopted.

```json adr-003-contract
{
  "modules": [
    "auth",
    "users",
    "programs",
    "ranking",
    "student",
    "staff",
    "admin",
    "notifications",
    "github",
    "platform"
  ],
  "rootSuffixes": [
    ".module",
    ".controller",
    ".service",
    ".repository",
    ".guard",
    ".interceptor",
    ".filter",
    ".client",
    ".error",
    ".types",
    ".config"
  ],
  "dtoSuffixes": [
    "-request.dto.ts",
    "-response.dto.ts"
  ],
  "rules": [
    "conventions/controller-explicit-return",
    "conventions/response-dto-shape",
    "conventions/request-dto-decorated",
    "conventions/file-name-convention",
    "conventions/file-class-match",
    "cross-app/no-cross-app-path",
    "boundaries/no-unknown-files",
    "architecture/no-cycle"
  ],
  "outOfScopeFiles": [
    "src/main.ts",
    "src/cli.ts",
    "src/app.module.ts",
    "src/app-controller-discovery.ts",
    "test/**/*.ts",
    "src/**/*.spec.ts",
    "src/**/*.integration.spec.ts",
    "src/**/*.spec.helpers.ts",
    "src/**/*.test.ts",
    "src/**/*fixture.ts",
    "src/**/*fixtures.ts",
    "src/**/*support.ts"
  ]
}
```
