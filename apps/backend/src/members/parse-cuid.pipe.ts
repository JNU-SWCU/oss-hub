import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const CUID_PATTERN = /^c[a-z0-9]{24}$/;

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!CUID_PATTERN.test(value)) {
      throw new BadRequestException({
        message: ['회원 ID 형식이 올바르지 않습니다.'],
        error: 'Bad Request',
        statusCode: 400,
      });
    }

    return value;
  }
}
