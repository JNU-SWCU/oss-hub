import { Controller, Get } from '@nestjs/common';
import { ApplicationTemplateListResponseDto } from './dto/application-template-response.dto';
import { Public } from '../auth/authentication.guard';
import { ProgramRulesService } from './program-rules.service';

@Controller('programs/application-templates')
@Public()
export class ApplicationTemplatesController {
  constructor(private readonly programRulesService: ProgramRulesService) {}

  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(
      this.programRulesService.listProgramTemplates(),
    );
  }
}
