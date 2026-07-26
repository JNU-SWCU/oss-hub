import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicProfileController } from './public-profile.controller';
import { PublicProfileService } from './public-profile.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicProfileController],
  providers: [PublicProfileService],
})
export class ProfilesModule {}
