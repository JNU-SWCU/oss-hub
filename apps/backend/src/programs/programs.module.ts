import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  imports: [AuthModule],
  controllers: [ProgramsController],
  providers: [ProgramsService],
})
export class ProgramsModule {}
