import { BadRequestException } from '@nestjs/common';
import { ParseCuidPipe } from './parse-cuid.pipe';

describe('ParseCuidPipe', () => {
  const pipe = new ParseCuidPipe();

  it('Prisma cuid 형식의 회원 ID를 통과시킨다', () => {
    const memberId = 'ckx1234567890123456789012';

    expect(pipe.transform(memberId)).toBe(memberId);
  });

  it('cuid 형식이 아닌 회원 ID는 검증 오류로 거부한다', () => {
    expect(() => pipe.transform('member-1')).toThrow(BadRequestException);

    try {
      pipe.transform('member-1');
    } catch (exception) {
      expect(exception).toBeInstanceOf(BadRequestException);
      expect((exception as BadRequestException).getResponse()).toMatchObject({
        message: ['회원 ID 형식이 올바르지 않습니다.'],
      });
    }
  });
});
