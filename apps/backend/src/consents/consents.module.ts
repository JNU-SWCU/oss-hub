import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentsController } from './controller/consents.controller';
import { ConsentsRepository } from './repository/consents.repository';
import { ConsentsService } from './service/consents.service';

@Module({
  imports: [AuthModule],
  controllers: [ConsentsController],
  providers: [ConsentsService, ConsentsRepository],
  exports: [ConsentsService],
})
export class ConsentsModule {}
