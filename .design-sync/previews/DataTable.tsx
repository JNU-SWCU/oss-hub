import {
  Button,
  DataTable,
  EmptyState,
  RowActions,
  StatusBadge,
  type DataTableColumn,
} from 'frontend';

interface StaffRequest {
  id: string;
  githubLogin: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

const STATUS_PRESENTATION = {
  PENDING: { label: '대기', variant: 'pending' as const },
  APPROVED: { label: '승인', variant: 'approved' as const },
  REJECTED: { label: '반려', variant: 'rejected' as const },
};

function baseColumns(): DataTableColumn<StaffRequest>[] {
  return [
    {
      id: 'requester',
      header: '요청자',
      cell: (request) => (
        <span className="font-medium">@{request.githubLogin}</span>
      ),
    },
    {
      id: 'requestedAt',
      header: '요청 시각',
      cell: (request) => request.requestedAt,
    },
    {
      id: 'status',
      header: '상태',
      cell: (request) => {
        const presentation = STATUS_PRESENTATION[request.status];
        return (
          <StatusBadge variant={presentation.variant}>
            {presentation.label}
          </StatusBadge>
        );
      },
    },
  ];
}

export function Default() {
  const rows: StaffRequest[] = [
    {
      id: '1',
      githubLogin: 'swcu-kim',
      requestedAt: '2026.07.21 14:02',
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
    },
    {
      id: '2',
      githubLogin: 'oss-park',
      requestedAt: '2026.07.18 09:40',
      status: 'APPROVED',
      decidedBy: '관리자 홍길동',
      decidedAt: '2026.07.19 10:15',
      rejectionReason: null,
    },
    {
      id: '3',
      githubLogin: 'campus-lee',
      requestedAt: '2026.07.15 21:11',
      status: 'REJECTED',
      decidedBy: '관리자 홍길동',
      decidedAt: '2026.07.16 08:30',
      rejectionReason: '재직 증빙 서류 미제출',
    },
    {
      id: '4',
      githubLogin: 'gh-student42',
      requestedAt: '2026.07.25 11:27',
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
    },
  ];

  const columns: DataTableColumn<StaffRequest>[] = [
    ...baseColumns(),
    {
      id: 'decision',
      header: '처리 정보',
      cell: (request) => (
        <div className="flex min-w-40 flex-col gap-1 text-sm">
          <span>{request.decidedBy ?? '-'}</span>
          <span className="text-muted-foreground">
            {request.decidedAt ?? ''}
          </span>
          {request.rejectionReason ? (
            <span className="text-muted-foreground">
              {request.rejectionReason}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">작업</span>,
      headClassName: 'text-right',
      cell: (request) => {
        if (request.status === 'PENDING') {
          return (
            <RowActions>
              <Button size="sm">승인</Button>
              <Button size="sm" variant="destructive">
                반려
              </Button>
            </RowActions>
          );
        }
        if (request.status === 'APPROVED') {
          return (
            <RowActions>
              <Button size="sm" variant="destructive">
                회수
              </Button>
            </RowActions>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="rounded-lg border border-border">
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(request) => request.id}
      />
    </div>
  );
}

export function Loading() {
  return (
    <div className="rounded-lg border border-border">
      <DataTable
        columns={baseColumns()}
        data={[]}
        rowKey={(request) => request.id}
        isLoading
        loadingSlot="요청 목록을 불러오는 중…"
      />
    </div>
  );
}

export function Empty() {
  return (
    <div className="rounded-lg border border-border">
      <DataTable
        columns={baseColumns()}
        data={[]}
        rowKey={(request) => request.id}
        emptyState={
          <EmptyState
            title="승인 대기 중인 요청이 없습니다"
            action={
              <Button variant="outline" size="sm">
                필터 초기화
              </Button>
            }
          />
        }
      />
    </div>
  );
}

export function LongText() {
  const rows: StaffRequest[] = [
    {
      id: '1',
      githubLogin: 'swcu-park',
      requestedAt: '2026.07.10 16:45',
      status: 'REJECTED',
      decidedBy: '관리자 임꺽정',
      decidedAt: '2026.07.12 09:05',
      rejectionReason:
        '제출한 재직 증빙 서류의 발급일이 6개월을 초과했고, 소속 학과 정보가 학적 시스템과 일치하지 않아 재확인이 필요합니다. 서류를 최신 발급본으로 다시 제출해 주세요.',
    },
  ];

  const columns: DataTableColumn<StaffRequest>[] = [
    ...baseColumns(),
    {
      id: 'decision',
      header: '처리 정보',
      cellClassName: 'whitespace-normal',
      cell: (request) => (
        <div className="flex min-w-40 flex-col gap-1 text-sm">
          <span>{request.decidedBy}</span>
          <span className="text-muted-foreground">{request.decidedAt}</span>
          <span className="text-muted-foreground">
            {request.rejectionReason}
          </span>
        </div>
      ),
    },
  ];

  return (
    <div className="rounded-lg border border-border">
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(request) => request.id}
      />
    </div>
  );
}
