import { redirect } from 'next/navigation';
import {
  decodeRouteProgramId,
  programHref,
} from '@/features/programs/program-paths';

// 학생 「우리 팀」은 /programs/[id]/team 이다(#1133). 대시보드(백엔드가 만든
// `teamUrl`)가 아직 이 주소를 가리키므로 파일을 남기고 새 주소로 보낸다.
export default async function ProgramMyTeamRedirectPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  redirect(programHref(decodeRouteProgramId(id), '/team'));
}
