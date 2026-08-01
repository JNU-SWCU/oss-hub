import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

async function buildController(
  isDatabaseReachable: () => Promise<boolean>,
): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [HealthService],
  })
    .overrideProvider(HealthService)
    .useValue({ isDatabaseReachable })
    .compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('PostgreSQL이 응답하면 기존 성공 응답을 반환한다', async () => {
    // Given: HealthService가 데이터베이스에 도달 가능하다고 보고한다.
    const isDatabaseReachable = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(true);
    const controller = await buildController(isDatabaseReachable);

    // When: 헬스 엔드포인트를 조회한다.
    const result = await controller.getHealth();

    // Then: 기존 응답 형식을 유지한다.
    expect(isDatabaseReachable).toHaveBeenCalled();
    expect(result).toEqual({ status: 'ok' });
  });

  it('PostgreSQL 연결 확인이 실패하면 503 예외를 반환한다', async () => {
    // Given: HealthService가 데이터베이스에 도달할 수 없다고 보고한다.
    const isDatabaseReachable = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(false);
    const controller = await buildController(isDatabaseReachable);

    // When: 헬스 엔드포인트를 조회한다.
    const action = controller.getHealth();

    // Then: curl --fail이 실패하도록 503 예외로 변환한다.
    await expect(action).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(action).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
