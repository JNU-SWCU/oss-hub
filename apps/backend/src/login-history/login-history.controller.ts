import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { LoginHistoryQueryRequestDto } from './dto/login-history-query.dto';
import { LoginHistoryPageResponseDto } from './dto/login-history-response.dto';
import { LoginHistoryService } from './login-history.service';

@Controller('users/me/login-history')
export class LoginHistoryController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginHistoryService: LoginHistoryService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  async findMine(
    @Req() request: AuthenticatedRequest,
    @Query() query: LoginHistoryQueryRequestDto,
  ): Promise<LoginHistoryPageResponseDto> {
    const user = await this.authService.getMe(request.sessionGithubId);
    const historyPage = await this.loginHistoryService.findMine(
      user.id,
      query.page,
      query.size,
    );
    return LoginHistoryPageResponseDto.from(historyPage);
  }
}
