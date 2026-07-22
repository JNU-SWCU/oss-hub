pipeline {
  agent {
    label 'oss-hub-production'
  }

  parameters {
    string(name: 'RELEASE_ACTION', defaultValue: '', description: 'GitHub release webhook action')
    string(name: 'RELEASE_TAG', defaultValue: '', description: 'GitHub Release tag (vMAJOR.MINOR.PATCH)')
  }

  options {
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  environment {
    COMPOSE_PROJECT_NAME = 'oss-hub'
    DEPLOY_STATE_FILE = '/var/lib/oss-hub/deploy-state/current-release'
    BACKUP_DIR = '/var/lib/oss-hub/backups'
  }

  stages {
    stage('실행 유형 판정') {
      steps {
        script {
          def action = params.RELEASE_ACTION.trim()
          def tag = params.RELEASE_TAG.trim()

          if (!tag) {
            if (action) {
              error('Release tag 없이 release action만 전달할 수 없습니다.')
            }
            env.RUN_MODE = 'main'
            env.DEPLOY_NOOP = 'false'
            env.CURRENT_DEPLOY_SHA = ''
            return
          }

          if (!(action == 'created' || action == 'published')) {
            error('created 또는 published Release 이벤트만 허용합니다.')
          }
          if (!(tag ==~ /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)) {
            error('Release tag는 vMAJOR.MINOR.PATCH 형식이어야 합니다.')
          }

          env.RUN_MODE = 'release'
          env.RELEASE_TAG = tag
          env.DEPLOY_NOOP = 'false'
          env.CURRENT_DEPLOY_SHA = ''
        }
      }
    }

    stage('소스 체크아웃') {
      steps {
        checkout scm
      }
    }

    stage('Release 검증 및 exact SHA checkout') {
      when {
        expression { env.RUN_MODE == 'release' }
      }
      steps {
        script {
          def releaseSha = sh(
            script: '''#!/usr/bin/env bash
set -euo pipefail

release_file="$(mktemp)"
trap 'rm -f "$release_file"' EXIT

curl --fail --silent --show-error \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  https://api.github.com/repos/JNU-SWCU/oss-hub/releases/latest \
  --output "$release_file"

test "$(jq -r '.draft' "$release_file")" = 'false'
test "$(jq -r '.prerelease' "$release_file")" = 'false'
test "$(jq -r '.tag_name' "$release_file")" = "$RELEASE_TAG"

git fetch --quiet origin refs/heads/main:refs/remotes/origin/main
git fetch --quiet origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}"
release_sha="$(git rev-parse "${RELEASE_TAG}^{commit}")"
git merge-base --is-ancestor "$release_sha" origin/main
printf '%s' "$release_sha"
''',
            returnStdout: true,
          ).trim()

          if (!(releaseSha ==~ /^[0-9a-f]{40}$/)) {
            error('Release tag를 정확한 commit SHA로 해석하지 못했습니다.')
          }
          env.IMAGE_TAG = releaseSha
          sh 'git checkout --detach "$IMAGE_TAG"'
        }
      }
    }

    stage('동일·하위 Release no-op 판정') {
      when {
        expression { env.RUN_MODE == 'release' }
      }
      steps {
        script {
          sh '''#!/usr/bin/env bash
set -euo pipefail
state_dir="${DEPLOY_STATE_FILE%/*}"
test -d "$state_dir"
test -r "$state_dir"
test -x "$state_dir"
test ! -L "$DEPLOY_STATE_FILE"
'''
          def stateExists = sh(
            script: 'test -e "$DEPLOY_STATE_FILE"',
            returnStatus: true,
          ) == 0
          if (!stateExists) {
            echo '정상 배포 이력이 없어 최초 배포를 계속합니다.'
            return
          }

          def persistedState = sh(
            script: '''#!/usr/bin/env bash
set -euo pipefail
test -f "$DEPLOY_STATE_FILE"
cat "$DEPLOY_STATE_FILE"
''',
            returnStdout: true,
          ).trim()

          def fields = persistedState.split(/\s+/)
          if (fields.size() != 2 ||
              !(fields[0] ==~ /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/) ||
              !(fields[1] ==~ /^[0-9a-f]{40}$/)) {
            error('현재 배포 상태 파일이 손상돼 자동 배포를 중단합니다.')
          }

          def currentTag = fields[0]
          env.CURRENT_DEPLOY_SHA = fields[1]
          if (env.RELEASE_TAG == currentTag && env.IMAGE_TAG != env.CURRENT_DEPLOY_SHA) {
            error("동일한 Release tag ${currentTag}가 기존 배포와 다른 SHA를 가리켜 자동 배포를 중단합니다.")
          }
          def newestTag = withEnv(["CURRENT_RELEASE_TAG=${currentTag}"]) {
            sh(
              script: '''printf '%s\n%s\n' "$CURRENT_RELEASE_TAG" "$RELEASE_TAG" | sort -V | tail -n 1''',
              returnStdout: true,
            ).trim()
          }
          if (env.RELEASE_TAG == currentTag || newestTag == currentTag) {
            env.DEPLOY_NOOP = 'true'
            currentBuild.description = "${env.RELEASE_TAG} no-op (current ${currentTag})"
            echo "${env.RELEASE_TAG}는 현재 정상 배포 ${currentTag}와 같거나 낮아 성공 no-op 처리합니다."
          }
        }
      }
    }

    stage('빌드·테스트 검증') {
      when {
        expression {
          env.RUN_MODE == 'main' ||
            (env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true')
        }
      }
      steps {
        sh '''
          pnpm install --frozen-lockfile
          pnpm lint
          pnpm typecheck
          pnpm test
          pnpm build
        '''
      }
    }

    stage('이전 이미지 태그 캡처') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          script {
            def frontendImage = sh(
              script: '''
                container="$(docker compose --env-file "$OSS_HUB_ENV_FILE" ps --all -q frontend)"
                if [ -n "$container" ]; then
                  docker inspect --format '{{.Config.Image}}' "$container"
                fi
              ''',
              returnStdout: true,
            ).trim()
            def backendImage = sh(
              script: '''
                container="$(docker compose --env-file "$OSS_HUB_ENV_FILE" ps --all -q backend)"
                if [ -n "$container" ]; then
                  docker inspect --format '{{.Config.Image}}' "$container"
                fi
              ''',
              returnStdout: true,
            ).trim()

            def frontendTag = frontendImage ? frontendImage.replaceFirst('^oss-hub-frontend:', '') : ''
            def backendTag = backendImage ? backendImage.replaceFirst('^oss-hub-backend:', '') : ''

            if (!frontendImage && !backendImage && env.CURRENT_DEPLOY_SHA?.trim()) {
              withEnv(["CURRENT_DEPLOY_SHA=${env.CURRENT_DEPLOY_SHA}"]) {
                sh '''
                  docker image inspect "oss-hub-frontend:${CURRENT_DEPLOY_SHA}" >/dev/null
                  docker image inspect "oss-hub-backend:${CURRENT_DEPLOY_SHA}" >/dev/null
                '''
              }
              frontendTag = env.CURRENT_DEPLOY_SHA
              backendTag = env.CURRENT_DEPLOY_SHA
            }

            if ((frontendImage && !frontendImage.startsWith('oss-hub-frontend:')) ||
                (backendImage && !backendImage.startsWith('oss-hub-backend:')) ||
                (frontendTag && backendTag && frontendTag != backendTag) ||
                (frontendTag && !backendTag) ||
                (!frontendTag && backendTag)) {
              error('실행 중인 frontend/backend 이미지 태그 상태가 일치하지 않습니다.')
            }

            env.PREV_TAG = frontendTag
            echo "PREV_TAG=${env.PREV_TAG ?: '(greenfield)'}"
          }
        }
      }
    }

    stage('PostgreSQL 기동 및 배포 전 백업') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh '''
            docker compose --env-file "$OSS_HUB_ENV_FILE" up -d postgres --wait --wait-timeout 90
            docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
            umask 077
            backup_target="${BACKUP_DIR}/${RELEASE_TAG}-${BUILD_NUMBER}.sql"
            test ! -e "$backup_target"
            backup_tmp="$(mktemp "${backup_target}.XXXXXX")"
            trap 'rm -f "$backup_tmp"' EXIT
            docker compose --env-file "$OSS_HUB_ENV_FILE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_tmp"
            test -s "$backup_tmp"
            mv "$backup_tmp" "$backup_target"
            trap - EXIT
          '''
        }
      }
    }

    stage('버전 이미지 빌드') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''
          docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .
          docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${IMAGE_TAG}" .
        '''
      }
    }

    stage('Prisma 마이그레이션') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          sh '''
            docker run --rm \
              --network "${COMPOSE_PROJECT_NAME}_default" \
              --env-file "$OSS_HUB_ENV_FILE" \
              "oss-hub-backend:${IMAGE_TAG}" \
              npx prisma migrate deploy
          '''
        }
      }
    }

    stage('서비스 교체 및 스모크 확인') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        withCredentials([file(credentialsId: 'oss-hub-production-env', variable: 'OSS_HUB_ENV_FILE')]) {
          script {
            try {
              sh '''
                docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 90
                curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1/
                curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1/api/v1/health
              '''
            } catch (deploymentFailure) {
              sh '''
                docker compose --env-file "$OSS_HUB_ENV_FILE" ps || true
                docker compose --env-file "$OSS_HUB_ENV_FILE" logs --no-color || true
              '''

              if (env.PREV_TAG?.trim()) {
                echo "서비스 교체 또는 스모크 실패: ${env.PREV_TAG} 이미지로 한 번 복구합니다."
                withEnv(["IMAGE_TAG=${env.PREV_TAG}"]) {
                  sh '''
                    docker compose --env-file "$OSS_HUB_ENV_FILE" up -d --no-build --wait --wait-timeout 90
                    curl --fail --silent --show-error http://127.0.0.1/
                    curl --fail --silent --show-error http://127.0.0.1/api/v1/health
                  '''
                }
              } else {
                echo '첫 배포 실패라 이전 이미지가 없습니다. 로그와 백업을 보존하고 수동 복구로 전환합니다.'
              }

              throw deploymentFailure
            }
          }
        }
      }
    }

    stage('정상 배포 상태 기록') {
      when {
        expression { env.RUN_MODE == 'release' && env.DEPLOY_NOOP != 'true' }
      }
      steps {
        sh '''
          umask 077
          state_tmp="$(mktemp "${DEPLOY_STATE_FILE}.tmp.XXXXXX")"
          trap 'rm -f "$state_tmp"' EXIT
          printf '%s %s\n' "$RELEASE_TAG" "$IMAGE_TAG" > "$state_tmp"
          mv "$state_tmp" "$DEPLOY_STATE_FILE"
          trap - EXIT
        '''
      }
    }
  }

  post {
    failure {
      echo 'Jenkins 배포가 실패했습니다. 기존 서비스 상태와 보존된 build·Compose 로그를 확인하십시오.'
    }
  }
}
