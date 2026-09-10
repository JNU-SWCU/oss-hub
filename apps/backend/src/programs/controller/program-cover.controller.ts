import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../../auth/auth-route-metadata';
import { ProgramCoverService } from '../service/program-cover.service';

@Controller('programs')
export class ProgramCoverController {
  constructor(private readonly covers: ProgramCoverService) {}

  @Get(':id/cover/:coverId')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(
    @Param('id') programId: string,
    @Param('coverId') coverId: string,
  ): Promise<StreamableFile> {
    const cover = await this.covers.read(programId, coverId);
    return new StreamableFile(cover.body, {
      type: cover.contentType,
      length: cover.size,
      disposition: 'inline',
    });
  }
}
