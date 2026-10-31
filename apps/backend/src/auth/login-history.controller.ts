import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './http-auth.types';
import { LoginHistoryRequestDto } from './dto/login-history-request.dto';
import { LoginHistoryPageResponseDto } from './dto/login-history-response.dto';
import { LoginHistoryService } from './auth.service';
import { Protected } from './authentication.guard';

@Controller('users/me/login-history')
export class LoginHistoryController {
  constructor(private readonly loginHistoryService: LoginHistoryService) {}

  @Get()
  @Protected()
  async findMine(
    @Req() request: AuthenticatedRequest,
    @Query() query: LoginHistoryRequestDto,
  ): Promise<LoginHistoryPageResponseDto> {
    const historyPage = await this.loginHistoryService.findMine(
      request.principal.id,
      query.page,
      query.size,
    );
    return LoginHistoryPageResponseDto.from(historyPage);
  }
}
