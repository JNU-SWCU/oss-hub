import { Controller, Get } from '@nestjs/common';
import { Protected } from '../auth/auth-route.decorator';
import { MyApplicationPreparationResponseDto } from './dto/my-application-preparation-response.dto';

@Controller('application-preparations')
@Protected()
export class ApplicationPreparationsController {
  @Get('programs/:programId/me')
  get(): MyApplicationPreparationResponseDto {
    return MyApplicationPreparationResponseDto.from();
  }
}
