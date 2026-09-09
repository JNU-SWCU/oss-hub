import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DeadlineDigestGuidanceRequestDto } from './dto/deadline-digest-guidance-request.dto';
import { DeadlineDigestSendRequestDto } from './dto/deadline-digest-send-request.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const previewToken = {
  previewedAt: '2026-08-14T00:00:00.000Z',
  previewVersion: 'a'.repeat(64),
};

describe.each([
  { name: 'preview', metatype: DeadlineDigestGuidanceRequestDto, token: {} },
  { name: 'send', metatype: DeadlineDigestSendRequestDto, token: previewToken },
])('$name guidance boundary', ({ metatype, token }) => {
  it.each([null, 123, false, [], {}, 'x'.repeat(4001)])(
    'rejects malformed guidance %# before entering the service',
    async (value) => {
      for (const field of ['studentGuidance', 'staffGuidance']) {
        await expect(
          pipe.transform(
            { ...token, [field]: value },
            { type: 'body', metatype },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );

  it.each([undefined, '', 'x'.repeat(4000), '<script>literal</script>\n&'])(
    'accepts omitted or bounded plain guidance %#',
    async (value) => {
      await expect(
        pipe.transform(
          { ...token, studentGuidance: value, staffGuidance: value },
          { type: 'body', metatype },
        ),
      ).resolves.toBeInstanceOf(metatype);
    },
  );
});
