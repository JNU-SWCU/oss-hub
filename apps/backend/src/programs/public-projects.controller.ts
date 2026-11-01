import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { PublicProjectRequestDto } from './dto/public-project-request.dto';
import {
  PublicProjectDetailResponseDto,
  PublicProjectPageResponseDto,
} from './dto/public-project-page-response.dto';
import { PublicProjectsService } from './public-projects.service';
import { Public } from '../auth/auth-route.decorator';

@Controller('projects')
@Public()
export class PublicProjectsController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async findPage(
    @Query() query: PublicProjectRequestDto,
  ): Promise<PublicProjectPageResponseDto> {
    return PublicProjectPageResponseDto.from(
      await this.publicProjectsService.findPage(
        query.pageId,
        query.pageSize,
        query.year,
      ),
    );
  }

  @Get(':projectId')
  @Header('Cache-Control', 'no-store')
  async findDetail(
    @Param('projectId') projectId: string,
  ): Promise<PublicProjectDetailResponseDto> {
    return PublicProjectDetailResponseDto.from(
      await this.publicProjectsService.findDetail(projectId),
    );
  }
}
