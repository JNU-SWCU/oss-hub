import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from '../service/health.service';

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
    const isDatabaseReachable = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(true);
    const controller = await buildController(isDatabaseReachable);

    const result = await controller.getHealth();

    expect(isDatabaseReachable).toHaveBeenCalled();
    expect(result).toEqual({ status: 'ok' });
  });

  it('PostgreSQL 연결 확인이 실패하면 503 예외를 반환한다', async () => {
    const isDatabaseReachable = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(false);
    const controller = await buildController(isDatabaseReachable);

    const action = controller.getHealth();

    await expect(action).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(action).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
