# Todo 2 prepare: main 동기화와 배포 경로 확인

2026-11-03. #1718 준비 브랜치만 갱신했다. PR merge, Release 발행, 운영 배포, 운영 데이터 변경은 수행하지 않았다. #1719는 수정하지 않았다.

## 병합과 마이그레이션 순서

- 이전 준비 head: `150166d879b7fd5a7d6835eac85d8680dadde7d8`.
- 병합한 origin/main: `fe00e178f484414cab754dea1559c95a68c511f2`, v0.24.29.
- 검증한 병합 커밋: `99a067fe849b3b357addfa9acf0f1cab70723dc7`.
- 충돌 없이 병합했다. 추가 main 변경은 랭킹 UI와 프로그램 이관 점검 도구이며 programs 제품 파일과 DB 마이그레이션 변경은 없다.
- 마지막 main migration `20261103130000_cycle_snapshot_daily` 뒤에 `20261103130000_prepare_program_dead_columns`가 정렬된다. 새 migration이 없어 재번호 부여가 필요하지 않았다. 실제 통합 테스트의 Prisma migrate deploy도 이 순서로 성공했다.
- prepare SQL SHA-256은 기존 리허설과 같은 `a381db6f234a508f45f6478f4cbec54e4046795fae3e52764bb363a8e1340c0a`다. SQL은 수정하지 않았다.
- prepare 브랜치에는 retire migration이 없다. 파일 원장에 동기화 기준을 추가했고 기존 257개 경로와 programs 줄 수는 그대로다.

## 검증 결과

무거운 검증은 한 번에 하나씩 실행했다. backend 통합 테스트는 다른 Docker 컨테이너가 없는 상태에서 시작했고 runner의 정리까지 완료했다.

| 실행 | 결과 | EXIT |
| --- | --- | ---: |
| backend: 요청된 `(schema-invariants\|team-invitations.integration\|program-teams.integration)` | 3 suites / 15 tests PASS | 0 |
| frontend: applications, teams, ranking/components의 vitest, `--maxWorkers=2` | 42 files / 599 tests PASS | 0 |
| `apps/backend`: `pnpm typecheck` | tsc 통과 | 0 |
| `apps/frontend`: `pnpm typecheck` | next typegen + tsc 통과 | 0 |
| `apps/backend`: `pnpm lint` | 오류 없음 | 0 |
| `apps/frontend`: `pnpm lint` | 오류 없음, 기존 경고 4개 | 0 |
| `pnpm lint:structure` | knip + scripts lint 통과 | 0 |
| `pnpm format:check` | 통과 | 0 |
| `pnpm check:file-ledger` | FILE_LEDGER_OK 257 paths | 0 |

이번 테스트는 prepare 브랜치 대상이다. 이전 retire 브랜치의 16개 결과를 재사용하지 않았다. 이번 병합은 backend 테스트를 변경하지 않았다.

남긴 기존 진단: frontend의 `shell-menu-sheet.test.tsx:20` 경고 3개, `failure-state.test.tsx:56` 경고 1개, backend boundaries 설정의 deprecated mode 경고, 원장 실행 시 Node의 MODULE_TYPELESS_PACKAGE_JSON 경고다. 해당 파일·설정은 origin/main과 같으며 경고를 숨기거나 테스트를 약화하지 않았다.

첫 타입/lint 호출은 잘못된 필터로 `No projects matched`가 나왔으므로 무효로 분류했다. 위 결과는 각 앱 디렉터리에서 직접 재실행하여 실제 tsc, next typegen, eslint 출력을 확인한 결과다.

원본 로그는 비공개 작업 증거의 `todo2-r3/{targeted-integration,frontend-vitest,typecheck-lint-verified,structure-format}.log`에 보존한다. 공개 문서에는 집계와 종료 코드만 담는다.

## 운영 READ ONLY 재점검

`default_transaction_read_only=on` 연결과 `REPEATABLE READ READ ONLY` 트랜잭션을 함께 사용했다. 두 read-only 설정 모두 on, `EXIT=0`. SQL 임시 파일은 제거했다. 덤프나 복원은 이번 작업에서 수행하지 않았다.

| 검사 | 수치 |
| --- | ---: |
| 두 파일 테이블의 중복 storageKey 그룹 | 각각 0 |
| Program / Milestone sentinel 시작일 | 각각 0 |
| 프로그램 기간 밖 마일스톤 | 0 |
| TeamMember 중복 복합키 / NULL 키 | 각각 0 |
| TeamMember incoming FK | 0 |
| 관련 제약 / invalid 제약 | 13 / 0 |
| TeamMember 인덱스 / invalid 또는 not-ready | 4 / 0 |
| 신규 storageKey 인덱스 이름 충돌 | 0 |
| 보존할 초대 시각 | 28 |
| 완료 / 미완료 migration | 84 / 0 |
| prepare / retire 적용 기록 | 0 / 0 |
| 이전 사전 점검 이후 시작·완료·rollback된 migration | 0 |

마지막 완료 migration은 여전히 `20261103130000_cycle_snapshot_daily`다. 이전 점검 시각 2026-11-03T14:13:10.328Z 이후 변경된 이력은 없고, 이전 리허설 도구 기준 d13bf30d 이후 main에도 migration 변경이 없다. 따라서 새 migration과 prepare의 충돌은 없다.

행 수는 Program 10, Milestone 20, SubmissionFile 81, MilestoneDocumentTemplateFile 5, Team 40, TeamMember 72, TeamInvitation 28이다. 기존 `(teamId,userId)` 및 `(programId,userId)` 인덱스는 unique/valid/ready이며 현재 물리 PK는 id다.

이 집계와 변경되지 않은 SQL의 기존 복원 리허설 기준으로 데이터 차단 조건은 없다. 실제 배포 시의 잠금·실행 결과를 미리 성공으로 주장하지 않으며, 배포 직전 점검 조건은 유지한다.

## 실제 rollback credential 확인

이전에는 실행 중 컨테이너의 값만 확인했다. 이번에는 Jenkins의 실제 release job 문맥에서 FileCredentials를 조회하여, Jenkinsfile의 `oss-hub-production-env` 원본을 서버 JVM 안에서만 읽었다. 다른 credential 내용은 읽지 않았으며 값·길이·해시를 반환하지 않았다.

```json
{"check":"rollback_credential_source","credential_matches":1,"key_assignments":1,"nonempty":true,"literal":true,"modified":false,"EXIT":0}
```

키 이름은 `TEAM_JOIN_CODE_SECRET`이다. 현재 credential에 정확히 한 번 정의된 non-empty literal임을 확인했다. Script Console의 오래된 폼은 먼저 CSRF 403으로 거부되었으며, 새 폼에서 읽기 전용 predicate만 실행했다. Job 실행·credential 수정은 하지 않았다.

후보 compose에서 전달 항목을 제거해도 credential 자체는 삭제되지 않는다. `activate-release.sh`의 복구는 **이전 compose + 현재 OSS_HUB_ENV_FILE**을 사용한다. pre-prepare 앱으로 되돌릴 수 있는 동안 이 원본 값을 계속 보존해야 한다.

## 실제 릴리스 배포 절차

### 트리거와 두 앱의 관계

1. main merge 자체는 CI를 실행한다. 이 저장소의 배포 입력은 **공개된 정식 GitHub Release**다.
2. backend: Jenkinsfile의 `H/10 * * * *` 타이머가 `/releases/latest`를 조회한다. 실제 job 설정에서도 같은 TimerTrigger를 확인했다. draft/prerelease를 거부하고 full SemVer tag를 exact commit SHA로 해석한 뒤 origin/main 이력에 속하는지 확인한다.
3. backend의 실행 중 tag/revision/이미지 상태를 검사한다. 같은 버전 또는 낮은 버전은 noop이고, 같은 tag에 다른 SHA면 실패한다. 새 버전이면 배포한다. 단순히 GitHub latest를 이전 tag로 바꾸는 것은 rollback이 아니다.
4. frontend: `.github/workflows/ci.yml`의 `release.published` 이벤트에서 `frontend-release-deploy`가 실행된다. Jenkins나 같은 workflow의 검증 job을 기다리는 `needs`는 없다. 두 앱은 원자적으로 함께 교체되지 않는다.
5. frontend는 tag의 exact SHA를 checkout하고 main 조상 여부를 검사한다. `select-release-deploy-scope.mjs`가 마지막 실제 Vercel 배포 성공 step의 SHA와 비교한다. frontend·패키지·lockfile 변경이 없거나 동일/더 최신 배포가 있으면 noop이다. 필요한 경우 Vercel production 프로젝트에서 `npx --yes vercel@58 deploy --prod --yes --token "$VERCEL_TOKEN"`을 실행한다(인증 값은 비공개 환경으로 제공).

### backend 일반 배포와 자동 백업

prepare는 이미 완료된 User consolidation의 특수 fenced 전환이 아니라 일반 배포 경로다.

1. root controller 경계와 서비스 상태를 검증하고 이전 compose, tag/SHA/이미지 ID, GitHub App 키 generation/identity를 복구 메타데이터로 캡처한다. candidate source는 Release SHA로 고정한다.
2. 운영 환경 credential과 GitHub App 키를 검증하고 새 키 generation을 staging한다.
3. **배포가 noop이 아니면 백업은 자동 실행된다.** 실행 중 PostgreSQL에서 pg_dump를 만들고 non-empty 파일을 확정한다. 이어 managed S3/R2 객체를 복사하여 개수·크기 영수증과 SHA-256 manifest를 만들고 복사본 해시를 검증한다. 실패하면 이후 단계로 진행하지 않는다.
4. backend 이미지를 Release tag와 revision label로 빌드한다.
5. candidate compose + 운영 env credential + staged keys로 `docker compose run --rm --no-deps backend npx prisma migrate deploy`를 실행한다. **기존 앱 교체 전에 해당 tag의 모든 미적용 migration을 실행한다.** 두 단계 migration을 한 Release에 담으면 안 되는 이유다.
6. 후보 nginx 구성을 사전 검사한 다음 `activate-release.sh`가 키 generation을 전환하고 backend/nginx만 `up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180`으로 재생성한다. PostgreSQL을 재생성하지 않는다.
7. 실제 tag/SHA/compose/key identity를 검증하고 nginx 설정 검사·reload·smoke check를 수행한다.
8. 성공 후 현재·직전 backend 이미지, 최신 백업 30개를 유지하고 build cache를 5GB 한도로 정리한다.

일반 자동 백업 경로는 덤프와 객체 해시를 검증하지만 자동 DB 복원 리허설을 실행하지 않는다. 새 `program-migration/rehearse.sh`와 manifest는 Jenkinsfile의 일반 배포 경로에 자동 연결되어 있지 않다.

### 정확한 실패 복구 범위

- migration 또는 활성화 전 사전 검사 실패: 아직 앱을 교체하지 않았으므로 기존 앱이 남는다. prepare SQL은 명시적 트랜잭션을 사용하지만 Prisma의 실패 migration 이력 처리를 자동으로 해결하는 코드는 없다.
- 활성화의 ERR trap이 설치된 이후 실패: 이전 키 identity를 검증하고 이전 generation으로 되돌린다. IMAGE_TAG를 이전 tag로 바꾸고 이전 compose(있으면 검증된 이전 image overlay 포함)에 **현재 운영 env credential**을 적용한다. 보관된 이전 이미지 ID를 검증한 뒤 backend/nginx를 같은 wait 옵션으로 재생성하고 이전 상태·키·nginx·smoke를 다시 검사한다.
- 복구 성공이면 `RECOVERY=ok; deployment remains failed`, 복구 실패면 `RECOVERY_FAILED`를 기록하며 원래 실패 코드로 종료한다. 자동 복구는 **앱·compose·키 복구이며 DB down migration/백업 restore가 아니다.**
- 활성화가 끝나 trap을 해제한 뒤의 실패나 나중에 발견한 기능 문제에는 이 자동 복구 trap이 적용되지 않는다. DB 복구, 완료 후 수동 앱 복구는 별도 운영 판단이 필요하다. 최신 Release가 그대로라면 다음 타이머에서 새 버전을 재시도할 수 있다.
- frontend 자동 rollback은 workflow에 없다. 별도 승인 후 Vercel에서 검증한 이전 production deployment를 선택해 `vercel rollback [deployment-id or url]`, `vercel rollback status`로 처리하는 별도 작업이다. 이전 Release workflow를 재실행해도 newer-deployment 판정으로 noop일 수 있다. 이 명령은 이번 작업에서 실행하지 않았다.
- retire 이후에는 prepared 앱까지만 앱 rollback이 가능하다. pre-prepare 앱으로 내려가려면 별도 데이터 복원 판단이 필요하다.

### 최근 실제 실행 영수증

| 항목 | 확인 결과 |
| --- | --- |
| v0.24.29 Release | 2026-11-03T15:17:43Z, SHA fe00e178f484414cab754dea1559c95a68c511f2 |
| frontend Actions run 41662386565 | Vercel 배포 step SUCCESS, 15:18:56Z~15:21:10Z |
| backend Jenkins #9229 | v0.24.28에서 v0.24.29 deploy, SUCCESS, 15:22:00.731Z~15:24:53.119Z |
| 이후 Jenkins #9230~#9232 | v0.24.29 noop, SUCCESS |
| 현재 backend OCI labels | v0.24.29 / fe00e178f484414cab754dea1559c95a68c511f2 |
| #9229 SQL backup / 객체 backup receipt | non-empty 존재 각각 1, 내용은 조회하지 않음 |
| v0.24.28 frontend run 41631517934 | 전체 job SUCCESS지만 Vercel 배포 step은 skipped, no-op step SUCCESS |

v0.24.29는 frontend 배포가 backend 배포 job 시작보다 먼저 완료됐다. Release나 workflow 전체의 success만으로 두 앱이 모두 새 버전이라고 간주하면 안 된다.

근거: `Jenkinsfile`, `.github/workflows/ci.yml`, `deploy/frontend/select-release-deploy-scope.mjs`, `deploy/jenkins/{activate-release.sh,probe-release-state.mjs}`와 위 실제 실행 기록. 수동 Vercel 명령은 [공식 CLI 문서](https://vercel.com/docs/cli/rollback)를 확인했다.
