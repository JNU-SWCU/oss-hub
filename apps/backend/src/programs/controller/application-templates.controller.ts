import { Controller, Get } from '@nestjs/common';
import { ApplicationTemplateListResponseDto } from './dto/application-template-response.dto';
import { listProgramTemplates } from './program-template.registry';

/**
 * 신청 템플릿 목록 — ProgramsController의 `:id` 캡처와 분리된 sibling controller.
 * 경로: GET /api/v1/programs/application-templates
 */
@Controller('programs/application-templates')
export class ApplicationTemplatesController {
  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(listProgramTemplates());
  }
}
