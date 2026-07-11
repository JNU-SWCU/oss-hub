import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { ParseCuidPipe } from './parse-cuid.pipe';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController],
  providers: [MembersService, MembersRepository, ParseCuidPipe],
})
export class MembersModule {}
