import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import { ProgramListQueryRequestDto } from './dto/program-list-query.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramsService } from './programs.service';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Get()
  async list(
    @Query() query: ProgramListQueryRequestDto,
  ): Promise<ProgramListPageResponseDto> {
    const programPage = await this.programsService.list(query.toQuery());
    return ProgramListPageResponseDto.from(programPage);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateProgramRequestDto,
  ): Promise<CreateProgramResponseDto> {
    const program = await this.programsService.create(
      request.sessionGithubId,
      input,
    );
    return CreateProgramResponseDto.from(program);
  }
}
