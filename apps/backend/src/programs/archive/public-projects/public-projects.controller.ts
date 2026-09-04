import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Public } from '../../../auth/auth-route-metadata';
import { PublicProjectQueryRequestDto } from './dto/public-project-query.dto';
import {
  PublicProjectDetailResponseDto,
  PublicProjectPageResponseDto,
  PublicProjectYearsResponseDto,
} from './dto/public-project-response.dto';
import { PublicProjectsService } from './public-projects.service';

@Controller('projects')
@Public()
export class PublicProjectsController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async findPage(
    @Query() query: PublicProjectQueryRequestDto,
  ): Promise<PublicProjectPageResponseDto> {
    return PublicProjectPageResponseDto.from(
      await this.publicProjectsService.findPage(
        query.pageId,
        query.pageSize,
        query.year,
      ),
    );
  }

  /**
   * 정적 경로를 `:projectId`보다 먼저 등록해 `years`가 id로 잡히지 않게 한다.
   */
  @Get('years')
  @Header('Cache-Control', 'no-store')
  async listYears(): Promise<PublicProjectYearsResponseDto> {
    return PublicProjectYearsResponseDto.from(
      await this.publicProjectsService.listYears(),
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
