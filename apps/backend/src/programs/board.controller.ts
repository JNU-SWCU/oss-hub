import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BoardPostPinResponseDto } from './dto/board-post-pin-response.dto';
import { DeletedResponseDto } from './dto/deleted-response.dto';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { BoardService } from './board.service';
import {
  BoardCommentResponseDto,
  BoardPostDetailResponseDto,
  BoardPostsPageResponseDto,
} from './dto/board-post-response.dto';
import { BoardPostListRequestDto } from './dto/board-post-list-request.dto';
import { CreateBoardCommentRequestDto } from './dto/create-board-comment-request.dto';
import { CreateBoardPostRequestDto } from './dto/create-board-post-request.dto';
import { SetBoardPostPinnedRequestDto } from './dto/set-board-post-pinned-request.dto';
import { UpdateBoardPostRequestDto } from './dto/update-board-post-request.dto';
import { Protected } from '../auth/auth-route.decorator';

type BoardActor = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/board/posts')
@Protected()
export class BoardController {
  constructor(private readonly service: BoardService) {}

  @Get()
  async list(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Query() query: BoardPostListRequestDto,
  ): Promise<BoardPostsPageResponseDto> {
    return BoardPostsPageResponseDto.from(
      await this.service.listPosts(
        programId,
        query.toQuery(),
        request.sessionGithubId,
      ),
    );
  }

  @Get(':postId')
  async detail(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
  ): Promise<BoardPostDetailResponseDto> {
    return BoardPostDetailResponseDto.from(
      await this.service.getPostDetail(
        programId,
        postId,
        request.sessionGithubId,
      ),
    );
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OriginGuard)
  async create(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Body() body: CreateBoardPostRequestDto,
  ): Promise<BoardPostDetailResponseDto> {
    return BoardPostDetailResponseDto.from(
      await this.service.createPost(programId, request.sessionGithubId, body),
    );
  }

  @Patch(':postId')
  @UseGuards(OriginGuard)
  async update(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Body() body: UpdateBoardPostRequestDto,
  ): Promise<BoardPostDetailResponseDto> {
    return BoardPostDetailResponseDto.from(
      await this.service.updatePost(
        programId,
        postId,
        request.sessionGithubId,
        body,
      ),
    );
  }

  @Delete(':postId')
  @UseGuards(OriginGuard)
  async delete(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
  ): Promise<DeletedResponseDto> {
    await this.service.deletePost(programId, postId, request.sessionGithubId);
    return DeletedResponseDto.from();
  }

  @Patch(':postId/pin')
  @UseGuards(OriginGuard)
  async setPinned(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Body() body: SetBoardPostPinnedRequestDto,
  ): Promise<BoardPostPinResponseDto> {
    await this.service.setPinned(
      programId,
      postId,
      request.sessionGithubId,
      body.pinned,
    );
    return BoardPostPinResponseDto.from(body.pinned);
  }

  @Post(':postId/comments')
  @HttpCode(201)
  @UseGuards(OriginGuard)
  async createComment(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Body() body: CreateBoardCommentRequestDto,
  ): Promise<BoardCommentResponseDto> {
    return BoardCommentResponseDto.from(
      await this.service.createComment(
        programId,
        postId,
        request.sessionGithubId,
        body,
      ),
    );
  }

  @Delete(':postId/comments/:commentId')
  @UseGuards(OriginGuard)
  async deleteComment(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ): Promise<DeletedResponseDto> {
    await this.service.deleteComment(
      programId,
      postId,
      commentId,
      request.sessionGithubId,
    );
    return DeletedResponseDto.from();
  }
}
