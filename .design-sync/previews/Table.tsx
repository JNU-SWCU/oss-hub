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
