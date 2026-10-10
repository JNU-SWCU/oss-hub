import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Public } from '../../../../auth/controller/auth-route-metadata';
import { PublicProjectQueryRequestDto } from '../dto/public-project-query.dto';
import {
  PublicProjectDetailResponseDto,
  PublicProjectPageResponseDto,
  PublicProjectYearsResponseDto,
} from '../dto/public-project-response.dto';
import { PublicProjectsService } from '../service/public-projects.service';

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
