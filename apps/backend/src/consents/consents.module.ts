import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentsController } from './consents.controller';
import { ConsentsStore } from './consents.store';
import { ConsentsService } from './consents.service';

@Module({
  imports: [AuthModule],
  controllers: [ConsentsController],
  providers: [ConsentsService, ConsentsStore],
  exports: [ConsentsService],
})
export class ConsentsModule {}
