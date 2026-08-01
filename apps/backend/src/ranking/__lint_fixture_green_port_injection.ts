import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';

@Injectable()
export class LintFixtureGreenPortInjectionService {
  constructor(
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
  ) {}
}
