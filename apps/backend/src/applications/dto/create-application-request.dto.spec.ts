import 'reflect-metadata';
import { CreateApplicationRequestDto } from './create-application-request.dto';

/**
 * #414 DEC-33/34 — isRepositoryPublicationPlanned 는 구 클라이언트가 생략해도
 * true 로 기본 설정되고(old-client-omission), 명시적 false 는 그대로 왕복해야 한다.
 */
describe('CreateApplicationRequestDto.toInput', () => {
  it('구 클라이언트가 필드를 생략하면 true 로 기본 설정한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 true 는 그대로 유지한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 false 는 true 로 덮어쓰지 않고 그대로 왕복한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(false);
  });
});
