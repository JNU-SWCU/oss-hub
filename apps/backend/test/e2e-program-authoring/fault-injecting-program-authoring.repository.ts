import { Injectable } from '@nestjs/common';
import { ProgramAuthoringRepository } from '../../src/programs/program-authoring.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { ProgramAuthoringTransactionStore } from '../../src/programs/repository/program-authoring-transaction';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFault,
} from './e2e-external-port-registry';

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
