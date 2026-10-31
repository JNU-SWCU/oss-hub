import { ProgramAuthoringUploadTransactionRepository } from '../../src/programs/program-authoring-upload-transaction.repository';
import { ProgramCoverRepository } from '../../src/programs/program-cover.repository';
import { Injectable } from '@nestjs/common';
import {
  ProgramAuthoringRepository,
  type ProgramAuthoringTransactionStore,
} from '../../src/programs/program-authoring.repository';
import { PrismaService } from '../../src/platform/prisma.service';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFault,
} from './e2e-external-port-registry';

@Injectable()
export class FaultInjectingProgramAuthoringRepository extends ProgramAuthoringRepository {
  constructor(
    prisma: PrismaService,
    programAuthoringUploadTransactionRepository: ProgramAuthoringUploadTransactionRepository,
    programCoverRepository: ProgramCoverRepository,
  ) {
    super(
      prisma,
      programAuthoringUploadTransactionRepository,
      programCoverRepository,
    );
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
