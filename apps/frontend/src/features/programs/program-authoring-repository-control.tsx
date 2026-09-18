import { FolderGit2, LockKeyhole } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';

export function ProgramAuthoringRepositoryControl({
  enabled,
  onEnabledChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-4 break-keep [overflow-wrap:anywhere]">
      <Field orientation="horizontal">
        <input
          id="authoring-repository-provisioning"
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <div className="grid gap-1">
          <FieldLabel htmlFor="authoring-repository-provisioning">
            GitHub 저장소 발급
          </FieldLabel>
          <p className="text-small text-muted-foreground">
            켜면 신청 승인 후 운영 조직에 새 저장소를 발급합니다.
          </p>
        </div>
      </Field>

      {enabled ? (
        <div className="grid gap-3">
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-4">
              <FolderGit2 aria-hidden="true" className="text-primary" />
              <div className="grid gap-1">
                <p className="font-semibold">새 저장소 발급받기</p>
                <p className="text-small text-muted-foreground">
                  승인되면 운영 조직에 비공개 저장소를 만들고 참여자를
                  초대합니다.
                </p>
              </div>
            </CardContent>
          </Card>
          <Alert>
            <LockKeyhole aria-hidden="true" />
            <AlertDescription className="break-keep [overflow-wrap:anywhere]">
              승인 후 신청자 또는 팀장은 프로그램 종료 전까지 공개 GitHub
              저장소로 변경할 수 있습니다. 변경 사유와 이력은 교직원에게
              표시됩니다.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <p className="text-small text-muted-foreground">
          신청 승인 시 저장소를 자동으로 발급하지 않습니다.
        </p>
      )}
    </div>
  );
}
