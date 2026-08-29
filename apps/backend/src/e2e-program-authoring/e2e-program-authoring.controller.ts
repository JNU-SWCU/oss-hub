import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import {
  E2eControlError,
  E2eProgramAuthoringService,
} from './e2e-program-authoring.service';
import { E2E_NOW } from './e2e-program-authoring-fixture';

@Controller('_e2e/program-authoring')
@UseGuards(SessionGuard)
export class E2eProgramAuthoringController {
  constructor(private readonly service: E2eProgramAuthoringService) {}

  @Post('reset')
  @HttpCode(200)
  async reset(@Req() request: Request): Promise<{ readonly now: string }> {
    this.requireLoopback(request);
    await this.service.reset();
    return { now: E2E_NOW.toISOString() };
  }

  @Get('fixture')
  async fixture(
    @Req() request: Request,
  ): Promise<{ readonly programId: string }> {
    this.requireLoopback(request);
    return this.service.fixture();
  }

  @Post('adopt')
  async adopt(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    this.requireLoopback(request);
    return await this.execute(() =>
      this.service.adopt(textField(body, 'programId'), request.sessionGithubId),
    );
  }

  @Get('state/:programId')
  async state(@Req() request: Request, @Param('programId') programId: string) {
    this.requireLoopback(request);
    return await this.execute(() => this.service.stateFor(programId));
  }

  @Post('applications')
  async application(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() => this.service.application(textField(body, 'mode')));
  }

  @Post('approve-and-run')
  async approveAndRun(@Req() request: Request): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() => this.service.approveAndRun());
  }

  @Post('preview')
  async preview(@Req() request: Request) {
    this.requireLoopback(request);
    return await this.execute(() => this.service.preview());
  }

  @Post('failures')
  @HttpCode(204)
  async failure(@Req() request: Request, @Body() body: unknown): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() =>
      this.service.failure(textField(body, 'failure'), field(body, 'count')),
    );
  }

  @Post('exercise')
  async exercise(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() => this.service.exercise(textField(body, 'failure')));
  }

  @Post('stale-preview')
  async stalePreview(@Req() request: Request): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() => this.service.stalePreview());
  }

  @Get('cross-team-current-file')
  async crossTeamCurrentFile(@Req() request: Request): Promise<void> {
    this.requireLoopback(request);
    await this.execute(() => this.service.crossTeamCurrentFile());
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof E2eControlError)
        throw new HttpException('Not found.', error.status);
      throw error;
    }
  }

  private requireLoopback(request: Request): void {
    const address = request.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1') {
      throw new HttpException('Not found.', 404);
    }
  }
}

function field(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    throw new HttpException('Invalid E2E request.', 400);
  }
  return Object.entries(body).find(([name]) => name === key)?.[1];
}

function textField(body: unknown, key: string): string {
  const value = field(body, key);
  if (typeof value !== 'string') {
    throw new HttpException('Invalid E2E request.', 400);
  }
  return value;
}
