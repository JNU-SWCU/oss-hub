import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthFlowService } from './auth-flow.service';
import { GithubLoginRequestDto } from './dto/github-login-request.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { OriginGuard } from '../platform/origin.guard';
import { type OptionalSessionRequest } from './http-auth.types';
import { OptionalSession, Protected, Public } from './auth-route.decorator';

@Controller('auth')
@Protected()
export class AuthController {
  constructor(private readonly authFlow: AuthFlowService) {}

  @Get('github')
  @Public()
  startGithubLogin(
    @Query() query: GithubLoginRequestDto,
    @Res() res: Response,
  ): void {
    this.authFlow.startGithubLogin(query.prompt, res);
  }

  @Get('github/callback')
  @Public()
  githubCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.authFlow.completeGithubCallback(
      { code, state, oauthError },
      req,
      res,
    );
  }

  @Get('session')
  @OptionalSession()
  getSession(
    @Req() req: OptionalSessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): SessionResponseDto {
    return SessionResponseDto.from(this.authFlow.sessionUser(req.auth, res));
  }

  @Post('logout')
  @OptionalSession()
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async logout(
    @Req() req: OptionalSessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    await this.authFlow.logout(req.auth, res);
    return LogoutResponseDto.from(false);
  }
}
