import { Injectable } from '@nestjs/common';

@Injectable()
export class ProgramMailKeyRepository {
  delivery(previewVersion: string, userId: string): string {
    return `program-mail:${previewVersion}:${userId}`;
  }
}
