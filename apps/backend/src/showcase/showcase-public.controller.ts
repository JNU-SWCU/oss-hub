import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import {
  type PublicArchiveDetailResponseDto,
  type PublicArchiveListResponseDto,
  PublicArchiveQueryRequestDto,
} from './dto/public-archive-response.dto';
import { ShowcasePublicService } from './showcase-public.service';

@Controller('repositories')
export class ShowcasePublicController {
  constructor(private readonly showcasePublicService: ShowcasePublicService) {}

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60')
  findPage(
    @Query() query: PublicArchiveQueryRequestDto,
  ): Promise<PublicArchiveListResponseDto> {
    return this.showcasePublicService.findPage(query);
  }

  @Get(':repositoryId/public')
  @Header('Cache-Control', 'public, max-age=60')
  findDetail(
    @Param('repositoryId') repositoryId: string,
  ): Promise<PublicArchiveDetailResponseDto> {
    return this.showcasePublicService.findDetail(repositoryId);
  }
}
