pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  environment {
    COMPOSE_PROJECT_NAME = 'oss-hub'
  }

  stages {
    stage('소스 체크아웃') {
      when {
        branch 'main'
      }
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          echo "IMAGE_TAG=${env.IMAGE_TAG}"
        }
      }
    }

    stage('이전 이미지 태그 캡처') {
      when {
        branch 'main'
      }
      steps {
        script {
          def frontendImage = sh(
            script: '''
              container="$(docker compose ps -q frontend || true)"
              if [ -n "$container" ]; then
                docker inspect --format '{{.Config.Image}}' "$container"
              fi
            ''',
            returnStdout: true,
          ).trim()
          def backendImage = sh(
            script: '''
              container="$(docker compose ps -q backend || true)"
              if [ -n "$container" ]; then
                docker inspect --format '{{.Config.Image}}' "$container"
              fi
            ''',
            returnStdout: true,
          ).trim()

          def frontendTag = frontendImage ? frontendImage.replaceFirst('^oss-hub-frontend:', '') : ''
          def backendTag = backendImage ? backendImage.replaceFirst('^oss-hub-backend:', '') : ''

          if ((frontendImage && !frontendImage.startsWith('oss-hub-frontend:')) ||
              (backendImage && !backendImage.startsWith('oss-hub-backend:')) ||
              (frontendTag && backendTag && frontendTag != backendTag) ||
              (frontendTag && !backendTag) ||
              (!frontendTag && backendTag)) {
            echo "frontend image=${frontendImage ?: '(없음)'}, tag=${frontendTag ?: '(없음)'}"
            echo "backend image=${backendImage ?: '(없음)'}, tag=${backendTag ?: '(없음)'}"
            sh 'docker compose ps; docker compose logs --no-color frontend backend || true'
            error('실행 중인 frontend/backend 이미지 태그 상태가 일치하지 않습니다.')
          }

          env.PREV_TAG = frontendTag
          echo "PREV_TAG=${env.PREV_TAG ?: '(greenfield)'}"
        }
      }
    }

    stage('이미지 빌드') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          docker build --file apps/frontend/Dockerfile --tag "oss-hub-frontend:${IMAGE_TAG}" .
          docker build --file apps/backend/Dockerfile --tag "oss-hub-backend:${IMAGE_TAG}" .
        '''
      }
    }

    stage('PostgreSQL 기동') {
      when {
        branch 'main'
      }
      steps {
        sh 'docker compose up -d postgres --wait --wait-timeout 90'
      }
    }

    stage('PostgreSQL 상태 확인') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
        '''
      }
    }

    stage('Prisma 마이그레이션') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          docker run --rm \
            --network "${COMPOSE_PROJECT_NAME}_default" \
            --env-file .env \
            "oss-hub-backend:${IMAGE_TAG}" \
            npx prisma migrate deploy
        '''
      }
    }

    stage('서비스 배포') {
      when {
        branch 'main'
      }
      steps {
        sh 'docker compose up -d --no-build --wait --wait-timeout 90'
      }
    }

    stage('스모크 확인') {
      when {
        branch 'main'
      }
      steps {
        sh '''
          curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1/
          curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1/api/v1/health
        '''
      }
      post {
        failure {
          script {
            if (env.PREV_TAG?.trim()) {
              echo "스모크 확인 실패: ${env.PREV_TAG} 태그로 복구합니다."
              withEnv(["IMAGE_TAG=${env.PREV_TAG}"]) {
                sh '''
                  docker compose up -d --no-build --wait --wait-timeout 90
                  curl --fail --silent --show-error http://127.0.0.1/
                  curl --fail --silent --show-error http://127.0.0.1/api/v1/health
                '''
              }
            } else {
              echo '스모크 확인 실패: greenfield 배포이므로 자동 복구하지 않습니다. Jenkins 로그와 아래 Compose 로그를 보존하고 수동 복구 절차를 따르십시오.'
              sh 'docker compose ps; docker compose logs --no-color || true'
            }
          }
        }
      }
    }
  }
}
