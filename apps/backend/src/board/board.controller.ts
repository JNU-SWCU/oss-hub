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
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { BoardActorRequest, BoardAccessGuard } from './board-access.guard';
import { BoardService } from './board.service';
import { BoardCommentResponseDto } from './dto/board-comment-response.dto';
import { BoardPostDetailResponseDto } from './dto/board-post-detail-response.dto';
import { BoardPostListRequestDto } from './dto/board-post-list-query.dto';
import { BoardPostsPageResponseDto } from './dto/board-posts-page-response.dto';
import { CreateBoardCommentRequestDto } from './dto/create-board-comment-request.dto';
import { CreateBoardPostRequestDto } from './dto/create-board-post-request.dto';
import { SetBoardPostPinnedRequestDto } from './dto/set-board-post-pinned-request.dto';
import { UpdateBoardPostRequestDto } from './dto/update-board-post-request.dto';

type BoardActor = Pick<
  BoardActorRequest,
  'sessionGithubId' | 'boardActorId' | 'boardActorIsStaff'
>;

/**
 * 프로그램 게시판 — 참여자(승인된 신청자)와 교직원만 접근한다(BoardAccessGuard).
 * 공지/질문 여부는 작성자 역할이 결정하고, 고정(pin)은 교직원만 할 수 있다.
 */
@Controller('programs/:programId/board/posts')
@UseGuards(SessionGuard, BoardAccessGuard)
export class BoardController {
  constructor(private readonly service: BoardService) {}

  @Get()
  async list(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Query() query: BoardPostListRequestDto,
  ): Promise<BoardPostsPageResponseDto> {
    const page = await this.service.listPosts(
      programId,
      query.toQuery(),
      request.boardActorId,
      request.boardActorIsStaff,
    );
    return BoardPostsPageResponseDto.from(page);
  }

  @Get(':postId')
  async detail(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
  ): Promise<BoardPostDetailResponseDto> {
    const post = await this.service.getPostDetail(
      programId,
      postId,
      request.boardActorId,
      request.boardActorIsStaff,
    );
    return BoardPostDetailResponseDto.from(post);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OriginGuard)
  async create(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Body() body: CreateBoardPostRequestDto,
  ): Promise<BoardPostDetailResponseDto> {
    const post = await this.service.createPost(
      programId,
      request.boardActorId,
      request.boardActorIsStaff,
      body,
    );
    return BoardPostDetailResponseDto.from(post);
  }

  @Patch(':postId')
  @UseGuards(OriginGuard)
  async update(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Body() body: UpdateBoardPostRequestDto,
  ): Promise<BoardPostDetailResponseDto> {
    const post = await this.service.updatePost(
      programId,
      postId,
      request.boardActorId,
      body,
    );
    return BoardPostDetailResponseDto.from(post);
  }

  @Delete(':postId')
  @UseGuards(OriginGuard)
  async delete(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
  ): Promise<{ readonly deleted: true }> {
    await this.service.deletePost(
      programId,
      postId,
      request.boardActorId,
      request.boardActorIsStaff,
    );
    return { deleted: true };
  }

  @Patch(':postId/pin')
  @UseGuards(OriginGuard)
  async setPinned(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Body() body: SetBoardPostPinnedRequestDto,
  ): Promise<{ readonly pinned: boolean }> {
    await this.service.setPinned(
      programId,
      postId,
      request.boardActorIsStaff,
      body.pinned,
    );
    return { pinned: body.pinned };
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
    const comment = await this.service.createComment(
      programId,
      postId,
      request.boardActorId,
      body,
    );
    return BoardCommentResponseDto.from(comment);
  }

  @Delete(':postId/comments/:commentId')
  @UseGuards(OriginGuard)
  async deleteComment(
    @Req() request: BoardActor,
    @Param('programId') programId: string,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ): Promise<{ readonly deleted: true }> {
    await this.service.deleteComment(
      programId,
      postId,
      commentId,
      request.boardActorId,
      request.boardActorIsStaff,
    );
    return { deleted: true };
  }
}
