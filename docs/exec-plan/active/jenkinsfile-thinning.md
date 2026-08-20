# Jenkinsfile thinning 실행 계획

이 문서는 root `Jenkinsfile`의 배포 계약을 보존하면서 검증 로직을 `scripts/jenkins/`로 추출하는 실행 계획이다.
이 문서는 실제 추출 코드가 아니라 범위·인터페이스·증거·복구 순서를 고정하는 계획이다.
현재 기준 줄 번호는 이 계획을 작성할 때 확인한 `Jenkinsfile` 700줄과 `scripts/check-jenkinsfile.sh` 565줄을 기준으로 한다(`scripts/check-jenkinsfile.sh`는 이후 P1 병합·계약 확장을 거쳐 commit `3c56b1e` 기준 1081줄로 늘었다. 이 값은 main이 이동해도 해당 커밋 시점의 사실로 고정된다).

## 기준 문서와 확인한 현재 구조

- 실행 파이프라인 원본은 [`Jenkinsfile`](../../../Jenkinsfile)이다.
- Jenkins 정적 계약 검사는 [`scripts/check-jenkinsfile.sh`](../../../scripts/check-jenkinsfile.sh)이다.
- 기존 실행 계획의 섹션·문장·완료 증거 형식은 [`init-operations.md`](init-operations.md)를 따른다.
- 배포 계약의 결정 원본은 [`ADR-002`](../../decisions/ADR-002-CI-CD-파이프라인.md)다.
- Jenkins 경로별 검증 명령의 원본은 [`CI 경로별 검증 계약`](../../rules/ci-path-verification.md)이다.
- PR 크기·직렬화·충돌 표면 규칙의 원본은 [`PR 범위·분해 기준`](../../rules/pr-scope.md)이다.
- high-risk·배포 계약 경로·PM 승인 규칙의 원본은 [`ADR-005`](../../decisions/ADR-005-agent-driven-review-cycle.md)다.
- `Jenkinsfile`의 pipeline·agent·options·environment 선언은 10~25줄, 소스 checkout은 27~33줄에 있다.
- 최신 Release 검증과 exact SHA 해석은 34~90줄의 `latest Release 검증 및 exact SHA 해석` stage에 있다.
- exact SHA detached checkout은 `exact SHA checkout` stage에 있고 그 앞에 승인 marker 검증 단계는 없다 — 배포 인가는 Release 발행 자체다.
- 실행 중 probe·no-op·이전 tag 캡처는 144~336줄의 `실행 중 이미지 기준 no-op 및 이전 태그 캡처` stage에 있다.
- `FRONTEND_URL` HTTPS 사전 검증은 337~410줄의 `FRONTEND_URL HTTPS 사전 검증` stage에 있다.
- rollback 이미지·OCI label·immutable ID 검증은 411~491줄의 `롤백 이미지 사전 검증` stage에 있다.
- 빌드·backup·migration·서비스 교체·retention과 실패 알림은 각각 492~507줄, 508~530줄, 531~554줄, 555~570줄, 572~621줄, 623~681줄, 685~699줄에 있다.
- `scripts/check-jenkinsfile.sh`는 parameterless latest Release 검사를 215~247줄, running-only no-op 검사를 249~397줄, HTTPS 검사를 398~430줄, rollback preflight를 432~449줄, stage 순서 검사를 515~562줄에서 수행한다.
- `ci-path-verification.md`의 Jenkins 행은 13줄이며 Jenkins 실행·이미지 빌드·실제 backup 접근 없이 fixture와 정적 계약을 검증하도록 한다.
- `pr-scope.md`는 14~15줄에서 200~400줄 초과를 분해 검토 트리거로 삼고, 24~29줄에서 stacked PR보다 직렬화를 기본으로 한다.
- `ADR-005` 51~65줄은 Jenkins·배포·rollback을 high-risk로 분류하고 배포 계약 경로를 열거한다.
- `ADR-005` 64줄의 현재 명시 목록에는 `scripts/jenkins/**`가 없으므로 G0에서 이 경로의 보호 적용 여부를 먼저 확정해야 한다.

## M1. 보존할 배포 계약과 책임 경계

시점: M2 이후 각 후보를 순서대로 추출하되 M1의 계약 증거를 먼저 고정한다.

### 계약 기준 문서

1. `ADR-002` 27~35줄의 parameterless latest Release, exact SHA, no-op, 배포 순서, rollback, success-only retention 결정을 유지한다.
2. `ci-path-verification.md` 13줄의 합성 fixture 회귀와 `bash scripts/check-jenkinsfile.sh Jenkinsfile` 검사를 유지한다.
3. `pr-scope.md` 6~15줄의 논리 단위·크기 기준과 24~29줄의 직렬화 원칙을 PR 분해에 적용한다.
4. `ADR-005` 51~72줄과 85~101줄의 high-risk, 배포 계약 경로, exact head·base, PM 승인 규칙을 적용한다.
5. `init-operations.md` 16~44줄과 83~110줄의 운영 순서·복구·완료 증거를 현재 계약의 실행 관점으로 대조한다.
6. 현재 동작의 세부 기준은 이 계획의 작성 시점에 직접 확인한 `Jenkinsfile`과 `scripts/check-jenkinsfile.sh`의 줄 범위를 따른다.

### 반드시 보존할 배포 계약

- Jenkins는 매개변수 없는 latest full Release를 선택하며 Jenkins 입력으로 tag·SHA·배포 모드를 받지 않는다.
- `draft=true`, `prerelease=true`, full SemVer가 아닌 tag는 Release 후보에서 거부한다.
- Release tag가 가리키는 exact commit SHA는 `origin/main` ancestry를 통과해야 한다.
- 배포 인가는 draft·prerelease가 아닌 GitHub Release 발행 자체이며 Jenkins는 별도 승인 marker를 요구하지 않는다.
- ancestry 검증을 통과한 exact SHA만 detached checkout한다.
- 실행 중 frontend와 backend는 tag, OCI revision, immutable image ID를 함께 읽고 둘의 metadata 일치를 검증한다.
- 실행 중 tag와 SHA가 target과 같으면 성공 no-op으로 처리한다.
- target SemVer가 실행 중 SemVer보다 낮으면 실행 중 양쪽 metadata가 완전하고 일치할 때만 성공 no-op으로 처리한다.
- partial, stopped, ambiguous, same-tag/different-SHA, 누락·불일치·비SemVer metadata는 fail-closed로 거부한다.
- `FRONTEND_URL`은 운영 env에서 정확히 한 번만 정의되어야 하며 `https://` scheme만 허용한다.
- rollback 대상 image의 immutable ID와 OCI version·revision label은 probe가 캡처한 이전 tag·SHA·image ID와 일치해야 한다.
- `backup → build → migration → replacement → smoke → success-only retention` 순서는 불변으로 유지한다.
- 자동 rollback은 직전 image를 대상으로 한 번만 수행하며 rollback 실패는 manual recovery로 전환한다.
- migration은 자동 역적용하지 않으며 backup 확인 뒤 승인된 수동 복구로 남긴다.
- `docker compose down -v`와 동등한 named volume 삭제 경로를 추가하지 않는다.
- credential 값, `FRONTEND_URL` 값, token, 내부 endpoint 값은 Jenkins stdout·stderr에 출력하지 않는다.

### Jenkinsfile에 남길 책임

- pipeline, 전용 agent, options, environment 선언과 `checkout scm`은 root `Jenkinsfile`에 남긴다.
- `withCredentials`의 scope와 file credential 주입은 root `Jenkinsfile`에 남긴다.
- 외부 script의 stdout을 읽고 허용 key 집합·값 형식·중복·누락·개행을 검증한 뒤 `env`로 바인딩하는 책임은 root `Jenkinsfile`에 남긴다.
- `currentBuild.description` 갱신과 상태별 `echo`·`error`는 Jenkins stage의 운영 의미가 드러나도록 root `Jenkinsfile`에 남긴다.
- 실패 알림 `emailext`와 수신자·SMTP의 Jenkins UI 위임은 root `Jenkinsfile`에 남긴다.
- stage 이름·순서와 `DEPLOY_NOOP != 'true'` 조건은 root `Jenkinsfile`의 선언적 흐름으로 남긴다.
- 빌드·backup·migration·replacement·smoke·success-only retention의 실행 stage는 계약 순서를 읽을 수 있는 잔여 wiring으로 남긴다.

### 범위 밖

- 이번 계획에서는 `Jenkinsfile`을 수정하지 않는다.
- 이번 계획에서는 `scripts/` 아래 어떤 파일도 생성·수정하지 않는다.
- 이번 계획에서는 ADR·운영 서버·Jenkins UI·Credentials Store·Compose 파일을 변경하지 않는다.
- 새 script의 실제 구현·fixture·테스트 코드는 후속 P1~P5 PR의 범위다.
- 배포 트리거·Release 발행·실제 서버 접속·실제 secret 값 확인은 이 문서의 실행 범위가 아니다.
- rollback 동작의 정책을 새로 결정하지 않고 `ADR-002`의 기존 계약을 보존한다.

## M2. 외부 script 공통 계약

시점: 첫 추출 PR에서 모든 `scripts/jenkins/` script와 동반 테스트에 공통으로 적용한다.

- 운영 script는 모두 `scripts/jenkins/` 아래에 배치한다.
- 각 운영 script에는 같은 이름의 `*.test.sh` shell fixture test를 둔다.
- 운영 script와 test는 `set -euo pipefail`을 사용한다.
- stdout은 고정된 machine-readable 결과만 출력하고 진단·실패 marker는 stderr로 출력한다.
- 정상 stdout은 `KEY=VALUE` 한 줄 한 쌍이며 허용 key 집합과 출력 순서는 인터페이스별로 고정한다.
- Jenkinsfile은 script 성공 뒤 허용 key 집합·정확한 key 개수·값 형식·개행 부재를 검증하고서만 `env`에 바인딩한다.
- Jenkinsfile은 알 수 없는 key, 중복 key, 누락 key, 빈 필수값, 개행 포함 값을 거부한다.
- exit 0은 계약을 만족한 성공이고 exit 1은 계약 위반 또는 외부 검증 실패인 fail-closed다.
- exit 2는 필수 인자·호출 인터페이스·필수 환경 입력이 잘못된 호출 오류다.
- Jenkins의 모든 nonzero exit는 해당 stage 실패로 전파하며 `|| true`로 삼키지 않는다.
- test는 실제 curl·git·docker를 호출하지 않고 임시 PATH에 둔 stub으로 각 입력과 실패 상태를 재현한다.
- test fixture는 stdout 계약과 stderr marker를 별도로 캡처해 비밀값이 stdout으로 누출되지 않음을 확인한다.

## M3. 추출 후보 구간 지도

시점: 각 후보는 지정된 현재 줄 범위와 checker 계약을 baseline으로 보존한 뒤 독립 PR로 추출한다.

### 후보 P4 — 최신 Release 검증과 exact SHA 해석

- 현재 구간: `Jenkinsfile` 34~90줄, stage 이름은 `latest Release 검증 및 exact SHA 해석`이다.
- 현재 동작: latest Release의 draft·prerelease·tag_name을 확인하고 full SemVer를 검증한 뒤 tag를 exact commit SHA로 해석하고 `origin/main` ancestry를 검사한다.
- 제안 경로: `scripts/jenkins/resolve-latest-release.sh`다.
- 제안 인터페이스: 인자는 없고 stdout은 정확히 `RELEASE_TAG=<full-semver>`와 `RELEASE_SHA=<40-hex-sha>` 두 줄이며 exit 0은 성공, exit 1은 Release·SemVer·ancestry 계약 위반, exit 2는 호출 인터페이스 오류다.
- stderr marker: `FAIL_CLOSED release_candidate`, `FAIL_CLOSED release_semver`, `FAIL_CLOSED release_ancestry` 같은 안정된 분류 marker를 사용하고 실제 URL·credential 값은 쓰지 않는다.
- Jenkinsfile 잔여 형태:

```groovy
def releaseOutput = sh(script: 'scripts/jenkins/resolve-latest-release.sh', returnStdout: true).trim()
def releaseFields = parseAndValidateReleaseFields(releaseOutput)
bindReleaseEnvironment(releaseFields)
```

- shell test fixture: 정상 latest full Release, draft, prerelease, 비SemVer, tag 누락, tag→SHA 해석 실패, main ancestry 실패, API 비배열·빈 응답, stdout key 중복·누락·알 수 없는 key, newline 값, 인자 오호출을 포함한다.
- checker 흡수·삭제 후보: `check-jenkinsfile.sh` 215~241줄의 legacy input·latest Release·SemVer·SHA 검사와 233~241줄의 exact marker 검사를 wiring 검사로 축소하거나 외부 script fixture로 이동한다.
- 위험과 순서: Release 선택이 틀리면 이후 checkout·image label 전체가 다른 대상을 가리키므로 P4는 `FRONTEND_URL` P2 뒤, probe P5 앞에 둔다.

### 후보 P5A — 실행 중 deployment probe와 no-op 판정

- 현재 구간: `Jenkinsfile` 144~336줄, stage 이름은 `실행 중 이미지 기준 no-op 및 이전 태그 캡처`다.
- 현재 동작: `docker compose ps -q`와 `ps --all -q`로 실행·존재 상태를 분류하고, running container의 image·OCI label·immutable ID를 검증해 greenfield·same tag+SHA no-op·SemVer downgrade no-op·deploy required·fail-closed를 판정한다.
- 제안 경로: `scripts/jenkins/probe-running-release.sh`다.
- 제안 인터페이스: 인자는 `<target-tag> <target-sha>`이고 `OSS_HUB_ENV_FILE`이 필수이며 stdout은 정확히 다음 6키를 고정 순서로 출력한다.

```text
DEPLOY_NOOP=<true|false>
DEPLOY_REASON=<greenfield|same_release|semver_downgrade|deploy_required>
PREV_TAG=<full-semver-or-empty>
PREV_SHA=<40-hex-sha-or-empty>
PREV_FE_IMAGE_ID=<immutable-id-or-empty>
PREV_BE_IMAGE_ID=<immutable-id-or-empty>
```

- exit 0은 완전한 판정 성공, exit 1은 probe 계약 위반·fail-closed 상태, exit 2는 target 인자 또는 `OSS_HUB_ENV_FILE` 호출 오류다.
- stderr marker: `FAIL_CLOSED partial`, `FAIL_CLOSED stopped`, `FAIL_CLOSED ambiguous`, `FAIL_CLOSED same_tag_different_sha`, `FAIL_CLOSED running_metadata`를 안정적으로 유지한다.
- Jenkinsfile 잔여 형태:

```groovy
withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
  def probeOutput = sh(script: 'scripts/jenkins/probe-running-release.sh "$RELEASE_TAG" "$RELEASE_SHA"', returnStdout: true).trim()
  def probeFields = parseAndValidateProbeFields(probeOutput)
  bindProbeEnvironment(probeFields)
  applyNoopDescriptionOrContinue(probeFields)
}
```

- shell test fixture: greenfield, same tag+SHA, lower SemVer, higher SemVer, same-tag/different-SHA, partial existing, partial running, stopped-only, ambiguous running, missing label, mismatched label, non-SemVer, missing image ID, compose probe nonzero, key 중복·누락·알 수 없는 key, newline 값, env file 누락을 포함한다.
- checker 흡수·삭제 후보: `check-jenkinsfile.sh` 249~397줄의 running-only·fail-closed·same-tag·downgrade 구조 검사를 fixture로 이동하고, 440~449줄의 probe image ID 출력·Jenkins binding 검사는 wiring marker만 남긴다.
- checker 순서 검사 보존 후보: `check-jenkinsfile.sh` 515~559줄의 probe 이후 stage 순서 검사는 추출 뒤에도 root stage marker를 확인하도록 유지한다.
- 위험과 순서: no-op 오판은 배포를 누락하거나 다른 SHA를 덮어쓸 수 있으므로 P5A는 P1~P4 계약이 병합된 뒤 실행하고 P5B wiring과 한 쌍으로 검증한다.

### 후보 P2 — `FRONTEND_URL` HTTPS preflight

- 현재 구간: `Jenkinsfile` 337~410줄, stage 이름은 `FRONTEND_URL HTTPS 사전 검증`이다.
- 현재 동작: credential file에서 `FRONTEND_URL`의 주석 제외 할당 수를 세고 정확히 하나인지 확인한 뒤 값 자체를 로그에 남기지 않고 `https://` scheme만 허용한다.
- 제안 경로: `scripts/jenkins/validate-frontend-url.sh`다.
- 제안 인터페이스: `OSS_HUB_ENV_FILE`이 필수이고 stdout은 정확히 `FRONTEND_URL_HTTPS=ok` 한 줄이며 exit 0은 성공, exit 1은 누락·중복·scheme 위반, exit 2는 호출 환경 오류다.
- stderr marker: `FAIL_CLOSED https_preflight_missing`, `FAIL_CLOSED https_preflight_duplicate`, `FAIL_CLOSED https_preflight_scheme`를 사용하며 URL 값은 출력하지 않는다.
- Jenkinsfile 잔여 형태:

```groovy
withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
  def urlCheck = sh(script: 'scripts/jenkins/validate-frontend-url.sh', returnStdout: true).trim()
  validateExactOutput(urlCheck, 'FRONTEND_URL_HTTPS=ok')
}
```

- shell test fixture: 정확히 한 개의 HTTPS 할당, 주석·공백 변형, 누락, 중복 순서 변형, HTTP, 빈 값, quote 변형, CRLF, 개행 포함 값, 값이 stdout·stderr에 나타나는지 검사를 포함한다.
- checker 흡수·삭제 후보: `check-jenkinsfile.sh` 398~430줄의 `FRONTEND_URL` 존재·HTTPS·count==0·count!=1 구조 검사를 fixture와 호출 marker 검사로 대체한다.
- 위험과 순서: preflight가 빠지면 운영 endpoint 계약을 위반할 수 있으므로 P2는 rollback image 확인 P1 직후이자 backup·build 이전에 둔다.

### 후보 P1 — rollback image·label·ID preflight

- 현재 구간: `Jenkinsfile` 411~491줄, stage 이름은 `롤백 이미지 사전 검증`이다.
- 현재 동작: greenfield가 아니면 이전 frontend·backend image의 존재, OCI version·revision label, tag image ID, 실행 중 캡처된 immutable ID와의 일치를 검증한다.
- 제안 경로: `scripts/jenkins/validate-rollback-images.sh`다.
- 제안 인터페이스: `PREV_TAG`, `PREV_SHA`, `PREV_FE_IMAGE_ID`, `PREV_BE_IMAGE_ID`가 필요하고 stdout은 정확히 `ROLLBACK_PREFLIGHT=ok` 한 줄이며 exit 0은 성공, exit 1은 image·label·ID 계약 위반, exit 2는 필수 환경 입력 오류다.
- stderr marker: `FAIL_CLOSED missing_rollback`, `FAIL_CLOSED rollback_label`, `FAIL_CLOSED rollback_image_id`를 사용하고 image ID 전체 값은 진단에 출력하지 않는다.
- Jenkinsfile 잔여 형태:

```groovy
if (env.PREV_TAG?.trim()) {
  withEnv(rollbackEnvironment()) {
    def rollbackCheck = sh(script: 'scripts/jenkins/validate-rollback-images.sh', returnStdout: true).trim()
    validateExactOutput(rollbackCheck, 'ROLLBACK_PREFLIGHT=ok')
  }
}
```

- shell test fixture: greenfield skip, 양쪽 image 존재, image 누락, label 누락, front/back label 불일치, PREV_TAG·PREV_SHA 불일치, front/back immutable ID 불일치, empty ID, 필수 env 누락, stdout·stderr 값 노출을 포함한다.
- checker 흡수·삭제 후보: `check-jenkinsfile.sh` 432~449줄의 image·label·ID marker 검사를 외부 fixture와 Jenkins wiring 검사로 대체한다.
- 위험과 순서: rollback 기준을 잘못 허용하면 장애 시 다른 바이트로 복구하므로 P1으로 가장 먼저 추출하고 P2 이후에만 backup·build 단계로 진행한다.

## M4. 추출 순서와 PR 분해

시점: G0 확인 뒤 P1부터 하나씩 병합하고 다음 PR은 직전 PR 병합 후 main에서 새로 시작한다.

### G0 — `scripts/jenkins/**` 보호 적용 확인

G0는 확인을 완료했고 결과는 **보호 미적용**이었다.

- `ADR-005`의 배포 계약 경로 정의는 `Jenkinsfile`, Compose·env·deploy·Dockerfile·workflow·checker 경로를 열거하지만 `scripts/jenkins/**`를 포함하지 않았다.
- `scripts/merge-policy-check-lib.mjs`의 `DEPLOY_CONTRACT_PATTERNS`도 같은 목록을 쓰므로, 판정기를 직접 호출해 확인한 결과 `scripts/jenkins/validate-rollback-images.sh`가 `일반` 변경으로 분류됐다.
- 즉 `Jenkinsfile`(PM 전속)의 절차 로직을 이 계획대로 추출하면 같은 배포 결정 로직이 파일 위치만 바뀌어 승인 요건이 낮아진다. 추출 자체가 우회 경로가 된다.
- 이 계획은 ADR-005·CODEOWNERS를 수정하지 않는다는 경계를 지키고, 보호 확장은 별도 PR로 분리했다 — Issue #387, PR #388이 판정기·ADR-005·검증 표·CODEOWNERS 네 곳에 `scripts/jenkins/**`를 추가했다.
- P1~P5의 blocker였던 **PR #388 병합**은 해소됐다(2026-07-30T15:55:20Z 병합, commit `318ba25`). 병합 후 첫 추출 PR인 P1이 `merge-policy`에서 `PM_ACCEPT` 요구로 판정되는 것을 확인하고 착수해 완료했다([PR #393](https://github.com/JNU-SWCU/oss-hub/pull/393) merged).

### PR 분해 원칙

- 추출 순서는 `rollback(P1) → FRONTEND_URL(P2) → Release resolver(P4) → probe(P5A 스크립트+테스트, P5B wiring)`이다.
- P1을 먼저 두는 이유는 모든 후속 mutation이 사용할 rollback byte identity를 mutation 전에 확정해야 하기 때문이다.
- P2를 두 번째로 두는 이유는 운영 endpoint 계약을 backup·build·migration 전에 fail-closed로 확정해야 하기 때문이다.
- P4를 P2 뒤에 두는 이유는 resolver가 해석한 exact SHA를 checkout과 image label이 그대로 공유해야 하기 때문이다.
- P5를 마지막에 두는 이유는 running probe가 앞 단계의 target identity와 credential scope를 모두 받아 no-op과 mutation 진입을 결정하기 때문이다.
- `pr-scope.md`의 직렬화 원칙에 따라 stacked PR을 금지하고 각 PR은 이전 PR 병합 후 main에서 새로 시작한다.
- 병합 게이트는 required check(`ci`·`public-safe`) 통과와 GitHub mergeable 상태뿐이다 — 댓글 기반 `MERGE_READY`·accept 게이트는 모두 폐지됐다(ADR-005 2026-08-04 변경).

### PR별 예상 변경량과 승인

| PR | 범위 | 예상 변경량 | 200~400줄 기준 위반 여부 | risk |
| --- | --- | ---: | --- | --- |
| P1 | rollback script·test·Jenkins wiring | 160~240줄 | 아니오 | HIGH_RISK |
| P2 | `FRONTEND_URL` script·test·Jenkins wiring | 100~180줄 | 아니오 | HIGH_RISK |
| P4 | Release resolver·test·Jenkins wiring | 180~280줄 | 아니오 | HIGH_RISK |
| P5A | probe script·test fixture | 240~380줄 | 아니오 | HIGH_RISK |
| P5B | probe Jenkins wiring·정적 checker 정렬 | 120~220줄 | 아니오 | HIGH_RISK |

- 변경량은 구현·test·fixture·wiring을 합친 예상치이며 200~400줄을 넘지 않도록 PR 시작 전에 다시 산정한다.
- 각 PR은 배포·rollback 계약을 다루므로 문서만 추가하는 이 계획 PR의 `GENERAL` 분류를 추출 PR에 전이하지 않는다.
- 각 P PR도 다른 PR과 동일하게 required check(`ci`·`public-safe`) 통과만으로 병합한다 — 댓글 기반 `MERGE_READY`·accept 게이트는 모두 폐지됐고(ADR-005 2026-08-04 변경), 실제 병합 권한 제한은 GitHub 저장소 설정이 맡는다.

## M5. 동등성 증명과 실행 증거

### Jenkins 실행 없이 확보할 증거

1. 추출 전 baseline 명령 결과를 저장한다.
2. `bash -n`으로 새 script와 test의 shell 문법을 확인한다.
3. 임시 PATH의 curl·git·docker stub을 사용해 모든 fixture를 실행한다.
4. test-only legacy oracle과 새 script에 동일 입력을 넣고 결과를 대조한다.
5. 대조 항목은 exit code, 정규화한 stdout, stderr 오류 분류 marker다.
6. normalizer는 계약 외 timestamp·임시 경로·stub ID 같은 값만 제거하고 계약 key·값·오류 분류는 제거하지 않는다.
7. `scripts/check-jenkinsfile.test.sh`의 합성 fixture가 기존 동작을 계속 통과하는지 확인한다.
8. `bash scripts/check-jenkinsfile.sh Jenkinsfile`가 root stage 순서·남은 책임·no-op 조건을 통과하는지 확인한다.
9. `node --test scripts/team-state-check.test.mjs`와 `bash scripts/check-public-safe.sh origin/main` 결과를 보존한다.
10. 각 PR의 exact head·base full SHA와 명령 결과를 PR 본문에 기록한다.

### PR별 Jenkins 실행 증거

- P1: 실행 중 deployment의 실제 `PREV_*`를 읽기 전용으로 사용해 rollback preflight가 성공·불일치 fail-closed를 구분하는지 확인한다.
- P2: `withCredentials` 안에서 script를 실행하고 `FRONTEND_URL` 값이 console stdout·stderr와 `currentBuild.description`에 노출되지 않는지 확인한다.
- P4: resolver 반환값의 `RELEASE_TAG`와 `RELEASE_SHA`가 checkout 대상과 image label 입력에 그대로 전달되는지 확인한다.
- P5A: curl·git·docker stub fixture에서 greenfield·same-release·downgrade·fail-closed 상태를 재현한다.
- P5B: same-release 실행이 성공 no-op으로 끝나고 mutation stage가 skip되는지 확인한다.

### 실제 Release 배포 증거

- P5B까지 병합한 뒤 완료 선언 전에 실제 Release SHA를 한 번 배포한다.
- 실제 배포 대상은 현재 실행 중 tag보다 높은 새 SemVer여야 하며 same-release no-op이 아닌 실제 배포 경로를 통과해야 한다.
- 배포 시 다음 아홉 가지를 관찰하고 exact head·base와 함께 기록한다.
  1. latest full Release 선택 결과와 draft·prerelease·full SemVer 거부 결과를 확인한다.
  2. Release tag의 exact SHA와 `origin/main` ancestry 결과를 확인한다.
  3. detached HEAD가 해석된 `RELEASE_SHA`와 같은지 확인한다.
  4. 실행 중 front/back의 tag·revision·immutable image ID와 `PREV_*` binding을 확인한다.
  5. `FRONTEND_URL`이 정확히 하나의 HTTPS 할당이고 값이 로그에 없는지 확인한다.
  6. rollback image의 immutable ID와 OCI version·revision label이 `PREV_*`와 일치하는지 확인한다.
  7. backup→build→migration 순서와 migration 자동 역적용 금지·`down -v` 부재를 확인한다.
  8. replacement와 loopback·TLS smoke가 성공하고 front/back image label이 target tag·SHA와 일치하는지 확인한다.
  9. success-only retention이 실행 중·직전 image와 backup 정책을 보존하고 실패 알림에 비밀값이 없는지 확인한다.

## M6. 롤백과 복구

### mutation 이전 실패

1. resolver·checkout·probe·HTTPS·rollback preflight 실패는 fail-closed로 stage를 중단한다.
2. mutation 이전에는 서비스 교체·migration·image deletion을 수행하지 않고 관련 stdout·stderr 진단만 보존한다.

### image build·backup 이후 실패

1. backup 또는 image build 실패는 migration과 replacement로 진행하지 않는다.
2. 성공 전 retention을 실행하지 않고 새 image와 backup 임시 산출물의 정리 결과를 확인한다.
3. 기존 실행 서비스와 `PREV_*` rollback 기준은 유지한다.

### migration 이후 실패

1. migration 실패 뒤 migration을 자동 역적용하지 않는다.
2. backup 존재·무결성과 실패한 Release의 로그를 확인한다.
3. schema가 호환되면 image rollback을 우선하고, DB restore는 승인된 manual recovery로 분리한다.

### service replacement·smoke 실패

1. `PREV_TAG`와 검증된 immutable image ID가 있으면 직전 image로 one-shot rollback을 수행한다.
2. one-shot rollback smoke가 실패하면 자동 재시도하지 않고 manual recovery로 전환한다.
3. greenfield는 이전 image가 없으므로 즉시 manual recovery로 전환하고 로그·backup·Compose 상태를 보존한다.

### 최종 원복 단위

- hot edit와 Jenkins UI의 임시 pipeline 교체로 복구하지 않는다.
- 복구는 PR 단위 revert로 수행하고 여러 PR이면 추출 순서의 역순으로 revert한다.
- Release tag는 이동·재태깅하지 않고 불변으로 유지한다.
- 복구 후 `bash scripts/check-jenkinsfile.sh Jenkinsfile`, fixture test, 정적 검증 명령을 다시 실행한다.
- 복구 결과에는 실패 SHA, 영향받은 PR, 보존한 backup·로그, 현재 실행 image ID를 남긴다.

## 완료 증거

- [x] G0에서 `scripts/jenkins/**`의 ADR-005 deploy-contract path 보호 적용 여부와 blocker 해소 근거를 확인했다.
- [ ] `Jenkinsfile`의 현재 stage 이름·줄 범위와 `scripts/check-jenkinsfile.sh`의 대응 검사 줄을 baseline으로 보존했다.
- [ ] M1의 latest Release·exact SHA·no-op·fail-closed·HTTPS·rollback·순서·보안 계약을 모두 대조했다.
- [ ] M2의 stdout key·stderr marker·exit code·nonzero 전파·stub fixture 공통 계약을 확정했다.
- [ ] P1~P5 후보별 script 경로·인자·stdout·exit code·stderr marker·잔여 Jenkins wiring·fixture·checker 정리 위치를 기록했다.
- [ ] P1→P2→P4→P5A→P5B 직렬 PR 순서와 각 PR의 HIGH_RISK 분류·required check 통과 조건을 기록했다.
- [ ] baseline 명령, `bash -n`, fixture, legacy oracle 동등성 대조, normalizer 범위의 결과를 PR별로 보존했다.
- [ ] P1~P5B의 Jenkins 증거를 해당 PR의 exact head·base full SHA와 함께 기록했다.
- [ ] 현재 실행 중 tag보다 높은 SemVer의 실제 Release SHA 배포 1회와 관찰 항목 아홉 가지를 완료했다.
- [ ] mutation 이전·build/backup 이후·migration 이후·replacement/smoke 실패·greenfield 복구 증거를 보존했다.
- [ ] hot edit·Jenkins UI 임시 교체 없이 PR 역순 revert와 사후 검증 절차를 확인했다.
- [x] `bash scripts/check-jenkinsfile.test.sh`와 `bash scripts/check-jenkinsfile.sh Jenkinsfile`가 통과했다.
- [ ] `bash scripts/check-public-safe.sh origin/main`이 통과했고 문서에 공개 금지 정보·시크릿·실명·개인 절대경로가 없다.
- [ ] 자기 저널에 항목을 추가하고 `node --test scripts/team-state-check.test.mjs`가 통과했다.
