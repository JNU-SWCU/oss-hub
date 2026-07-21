import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import { ProgramsService } from './programs.service';

@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

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
