// Table 프리뷰 — DataTable이 내부적으로 조합하는 원시 컴포넌트
// (apps/frontend/src/components/data-table.tsx)를 직접 손으로 조립한 버전이다.
// DataTable에는 없는 TableCaption·TableFooter까지 함께 써서 "프로그램별 모집 현황
// 요약표"를 구성한다 — 합계 행이 있는 표는 DataTable로는 못 만든다(footer prop 없음).
import {
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from 'frontend';

interface ProgramSummary {
  id: string;
  name: string;
  capacity: number;
  applicants: number;
  status: 'recruiting' | 'closed';
}

export function Default() {
  const rows: ProgramSummary[] = [
    {
      id: '1',
      name: '캡스톤 디자인 경진대회',
      capacity: 20,
      applicants: 34,
      status: 'recruiting',
    },
    {
      id: '2',
      name: 'SW 해커톤',
      capacity: 40,
      applicants: 40,
      status: 'closed',
    },
    {
      id: '3',
      name: '오픈소스 컨트리뷰션 아카데미',
      capacity: 15,
      applicants: 9,
      status: 'recruiting',
    },
  ];
  const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  const totalApplicants = rows.reduce((sum, row) => sum + row.applicants, 0);

  return (
    <Table>
      <TableCaption>2026년 하반기 프로그램 모집 현황</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>프로그램명</TableHead>
          <TableHead>모집 정원</TableHead>
          <TableHead>신청 인원</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell>{row.capacity}명</TableCell>
            <TableCell>{row.applicants}명</TableCell>
            <TableCell>
              <StatusBadge variant={row.status}>
                {row.status === 'recruiting' ? '모집중' : '마감'}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>합계</TableCell>
          <TableCell>{totalCapacity}명</TableCell>
          <TableCell>{totalApplicants}명</TableCell>
          <TableCell>-</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

// 프로그램명이 아주 길 때 셀이 줄바꿈되는지 — table-layout이 auto라 TableCell(td)
// 자체에 max-width를 줘도 열 폭이 그대로 늘어난다. admin-users-view.tsx처럼 셀 안에
// 블록 요소(div)를 하나 두고 거기에 max-width + whitespace-normal을 줘야 실제로
// 줄바꿈된다.
export function LongText() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>프로그램명</TableHead>
          <TableHead>모집 정원</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <div className="max-w-sm whitespace-normal font-medium">
              2026학년도 2학기 소프트웨어중심대학 오픈소스 커뮤니티 기여
              프로그램 참가자 모집
            </div>
          </TableCell>
          <TableCell>30명</TableCell>
          <TableCell>
            <StatusBadge variant="recruiting">모집중</StatusBadge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">교외 연합 해커톤</TableCell>
          <TableCell>50명</TableCell>
          <TableCell>
            <StatusBadge variant="closed">마감</StatusBadge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
