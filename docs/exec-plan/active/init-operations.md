# 초기 운영 절차

이 문서는 초기 배포 전후 수동 운영 절차의 단일 소유 문서다. 비밀값은 저장소에 기록하지 않으며 `.env.example`만 추적한다.

## M1. branch protection 설정

시점: PR2가 병합된 직후에 main 브랜치 보호 규칙을 설정한다.

1. GitHub 저장소의 Settings > Branches에서 main 대상 branch protection rule을 만든다.
2. Pull request를 통한 병합을 필수로 하고 최소 1개의 승인 리뷰를 요구한다.
3. required status checks에 정확히 `ci`를 추가하고, 최신 커밋이 해당 check를 통과하도록 요구한다.
4. PR을 열어 `ci`가 모든 PR에서 보고되는지 확인한다. 변경 경로가 CI 대상이 아니어도 내부 paths gate가 성공 결과를 보고해야 한다.
5. 설정 화면과 통과한 PR의 `ci` 상태를 완료 증거로 보관한다.

## M2. Jenkins webhook 설정

### main 전용 webhook

1. Jenkins에 배포 pipeline을 만들고 GitHub webhook 수신 URL을 확인한다.
2. GitHub webhook은 push 이벤트를 사용하고 main 브랜치 병합만 pipeline을 시작하도록 Jenkins branch filter를 설정한다.
3. Jenkins pipeline에 `disableConcurrentBuilds()`를 설정한다.
4. Jenkins 환경에서 `COMPOSE_PROJECT_NAME`을 고정된 값으로 설정한다.

### 배포 순서

1. 대상 main 커밋 SHA를 읽어 `IMAGE_TAG`로 설정한다.
2. 해당 SHA 태그로 front와 back 이미지를 서버 로컬에서 한 번만 빌드한다. 레지스트리에 push하거나 pull하지 않는다.
3. PostgreSQL을 먼저 기동한다.
4. `prisma migrate deploy`를 실행한다.
5. `up -d --no-build --wait`로 nginx, front, back, postgres를 기동한다.
6. `/`와 `/api/v1/health`에 smoke check를 수행한다.
7. 성공한 배포의 `IMAGE_TAG`를 다음 배포에서 사용할 `PREV_TAG`로 기록한다.

Compose 종료·재기동 절차에서 `down -v`를 실행하지 않는다. PostgreSQL 데이터는 named volume `pgdata`에 보존한다.

## M3. 배포 서버와 개발 환경변수

### 배포 서버

1. 배포 서버의 접근 제한된 경로에 `.env`를 배치한다.
2. `.env`에는 운영 `POSTGRES_*` 값과 `DATABASE_URL`을 설정한다.
3. 저장소에는 `.env.example`만 두고 실제 `.env`는 커밋하지 않는다.
4. Jenkins가 Compose 및 migration 실행 전에 해당 `.env`를 읽을 수 있는지 확인한다.

### 개발 환경

1. 개발자는 Docker로 PostgreSQL 컨테이너만 실행한다.
2. 애플리케이션 실행 시 `DATABASE_URL`을 package script의 인라인 환경변수 또는 `direnv`로 주입한다.
3. 개발 `.env`를 커밋하지 않는다.
4. `pnpm` 핫리로드로 frontend와 backend를 실행하고, 연결 대상이 개발 PostgreSQL인지 확인한다.

## 복구 절차

### PREV_TAG가 있는 배포 실패

1. 실패한 smoke check와 Jenkins 콘솔 로그를 보존한다.
2. Compose 서비스의 이미지 태그를 `PREV_TAG`로 되돌린다.
3. `up -d --no-build --wait`로 이전 이미지를 기동한다.
4. `/`와 `/api/v1/health` smoke check를 다시 수행한다.
5. 복구 결과, 실패 SHA, `PREV_TAG`, 로그 위치를 운영 기록에 남긴다.

### greenfield 배포 실패

`PREV_TAG`가 없는 첫 배포는 자동 rollback 대상이 없다. Jenkins 콘솔 로그와 Compose 서비스 로그를 보존하고, 배포 서버의 Jenkins build 기록 및 Compose 프로젝트 로그 위치를 운영 기록에 남긴다. 원인을 수정한 뒤 같은 SHA 규칙으로 수동 재배포한다. 데이터 볼륨 삭제를 위한 `down -v`는 사용하지 않는다.

## 완료 증거

- main branch protection 화면에서 required status check가 `ci`이고 리뷰 필수인 화면 캡처 또는 설정 기록
- PR에서 `ci`가 통과한 상태 기록
- GitHub webhook과 Jenkins main-only branch filter 설정 기록
- Jenkins pipeline의 `disableConcurrentBuilds()` 및 고정 `COMPOSE_PROJECT_NAME` 설정 기록
- 배포 로그의 `IMAGE_TAG` SHA, PostgreSQL 선기동, migration, `up -d --no-build --wait` 실행 기록
- `/`와 `/api/v1/health` smoke check 결과
- `PREV_TAG` rollback 또는 greenfield 수동 복구 절차를 확인한 기록
- 배포 서버 `.env`는 비공개로 관리되고 저장소에는 `.env.example`만 존재한다는 확인 기록
