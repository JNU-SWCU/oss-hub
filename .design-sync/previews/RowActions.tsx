import { Button, RowActions } from 'frontend';

export function PendingActions() {
  return (
    <RowActions>
      <Button size="sm">승인</Button>
      <Button size="sm" variant="destructive">
        반려
      </Button>
    </RowActions>
  );
}

export function RevokeAction() {
  return (
    <RowActions>
      <Button size="sm" variant="destructive">
        회수
      </Button>
    </RowActions>
  );
}
