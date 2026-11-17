import { ProgramNoticeFetchClient } from '../src/programs/program-notice-fetch.client';
import { ProgramNoticeHtmlClient } from '../src/programs/program-notice-html.client';
import { ProgramNoticeUrlClient } from '../src/programs/program-notice-url.client';
import { ProgramNoticeExtractClient } from '../src/programs/program-notice-extract.client';
import { ProgramNoticeCandidatesClient } from '../src/programs/program-notice-candidates.client';
import { ProgramNoticeListClient } from '../src/programs/program-notice-list.client';

export function createProgramNoticeFetchClient(): ProgramNoticeFetchClient {
  const html = new ProgramNoticeHtmlClient();
  const urls = new ProgramNoticeUrlClient();
  return new ProgramNoticeFetchClient(
    urls,
    new ProgramNoticeExtractClient(
      html,
      urls,
      new ProgramNoticeCandidatesClient(),
    ),
    new ProgramNoticeListClient(html, urls),
  );
}
