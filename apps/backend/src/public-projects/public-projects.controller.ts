import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { PublicProjectQueryRequestDto } from './dto/public-project-query.dto';
import {
  PublicProjectDetailResponseDto,
  PublicProjectPageResponseDto,
} from './dto/public-project-response.dto';
import { PublicProjectsService } from './public-projects.service';

@Controller('projects')
export class PublicProjectsController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  async findPage(
    @Query() query: PublicProjectQueryRequestDto,
  ): Promise<PublicProjectPageResponseDto> {
    return PublicProjectPageResponseDto.from(
      await this.publicProjectsService.findPage(query.pageId, query.pageSize),
    );
  }

  @Get(':projectId')
  @Header('Cache-Control', 'public, max-age=60')
  async findDetail(
    @Param('projectId') projectId: string,
  ): Promise<PublicProjectDetailResponseDto> {
    return PublicProjectDetailResponseDto.from(
      await this.publicProjectsService.findDetail(projectId),
    );
  }
}
