# ADR-003: Backend module structure, naming, and DTO conventions

## Context

The backend `src/` had more than 20 folders, each split into layer subfolders (controller, service, repository, domain), so reading one feature meant jumping across many places. File names and DTO shapes also differed per module. This ADR fixes a 10-module layout and only the rules a linter can enforce.

## Decision

### Module map

| Module | Absorbs old folders |
| --- | --- |
| `auth` | `auth`, `login-history` |
| `users` | `users`, `roles` (onboarding, role-requests), `consents` |
| `programs` | `programs` (incl. `public/*`), `board`, `team-invitations`, `applications`, `submissions`, `submission-reviews`, `milestone-documents` |
| `ranking` | `ranking` |
| `student` | New. Student dashboard, my repositories |
| `staff` | New. Staff dashboard, insights, staff menu reads |
| `admin` | New. Admin users controllers, audit log query, `system-status`, collection admin |
| `notifications` | `notifications` |
| `github` | `github` (collection, repositories) |
| `platform` | `prisma`, `runtime-config`, `storage`, `health`, `common`, audit log write |

### Folder rule

- A module folder is depth 1. The only subfolder is `dto/`.
- One folder is one Nest module.
- A module's public API is what it lists in `exports`, nothing else.

### Naming

- File names are kebab-case. Resources are plural (`programs`), concepts singular (`auth`, `ranking`).
- Root file suffixes come from a closed list of 14: `.module` `.controller` `.service` `.repository` `.guard` `.interceptor` `.filter` `.client` `.job` `.scheduler` `.policy` `.error` `.types` `.config`.
- Class name is PascalCase(stem) plus the suffix, e.g. `program-board.service.ts` -> `ProgramBoardService`.
- DTO files are `dto/*-request.dto.ts` and `dto/*-response.dto.ts`.
- Exempt: `src/main.ts`, `src/app.module.ts`, `src/app-controller-discovery.ts`, `test/**/*.ts`, `src/**/*.spec.ts`, `src/**/*.integration.spec.ts`, `src/**/*.spec.helpers.ts`, `src/**/*.test.ts`, `src/**/*fixture.ts`, `src/**/*fixtures.ts`, `src/**/*support.ts`.

### DTOs

- Request DTOs hold fields plus class-validator decorators only.
- Response DTOs hold `declare readonly` fields and a `static from()` that returns an object literal in the baseline JSON key order. No mapped-types.
- Absence is an explicit state field, never null. Nest sends null as an empty 200 body.

```ts
export class ProgramSummaryResponseDto {
  declare readonly id: string;
  static from(p: Program) { return { id: p.id }; }
}
```

### Placement

- A read endpoint lives in the audience module (`student`, `staff`, `admin`) of the lowest-privilege menu that calls it.
- Writes stay in the module that owns the data.
- Frontend and backend never reference each other's paths.

## Consequences

These checks enforce the rules.

| Rule id | Check |
| --- | --- |
| `conventions/controller-explicit-return` | Controller handlers return an explicit response DTO type |
| `conventions/response-dto-shape` | Response DTOs have only `declare readonly` fields and `static from()` |
| `conventions/request-dto-decorated` | Every request DTO field has a class-validator decorator |
| `conventions/file-name-convention` | File names follow kebab-case and the closed suffix list |
| `conventions/file-class-match` | Class name matches the file stem and suffix |
| `cross-app/no-cross-app-path` | No path references between frontend and backend |
| `boundaries/no-unknown-files` | No folders or files outside the module map |
| `architecture/no-cycle` | No dependency cycles between modules |

Rejected options: nested contexts, vertical slice, `@Expose` serialization, mapped-types, nestjs-zod, nestia.

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
    ".job",
    ".scheduler",
    ".policy",
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
  "exemptFiles": [
    "src/main.ts",
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
  ],
  "crossAppExceptions": []
}
```
