import { Injectable } from '@nestjs/common';
import { ProgramAuthoringRepository } from '../../src/programs/program-authoring.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { ProgramAuthoringTransactionStore } from '../../src/programs/program-authoring.types';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFault,
} from './e2e-external-port-registry';

/**
 * E2E 전용 fault injection — 운영 `withTransaction`을 그대로 감싸 트랜잭션 조립은
 * 재사용하고, 실패는 그 콜백 안에서만 던진다. `super.withTransaction`에 넘기는
 * 콜백이 곧 Prisma `$transaction` 콜백 안에서 실행되므로, 여기서 throw해야
 * 실제로 rollback된다(콜백 밖에서 던지면 이미 커밋된 뒤다).
 */
@Injectable()
export class FaultInjectingProgramAuthoringRepository extends ProgramAuthoringRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  override withTransaction<T>(
    operation: (store: ProgramAuthoringTransactionStore) => Promise<T>,
  ): Promise<T> {
    return super.withTransaction(async (store) => {
      const result = await operation(store);
      if (
        e2eProgramAuthoringExternalPorts.failures.consume(
          E2E_EXTERNAL_FAILURE_OPERATIONS.PRISMA_TRANSACTION,
        )
      ) {
        throw new E2eExternalPortFault();
      }
      return result;
    });
  }
}
