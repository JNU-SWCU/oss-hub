import { FolderGit2, GitFork, LockKeyhole } from 'lucide-react';
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
    <div className="grid gap-4">
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
            켜면 신청자가 승인 이후 사용할 저장소 방식을 신청서에서 선택합니다.
          </p>
        </div>
      </Field>

      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-2">
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
          <Card>
            <CardContent className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-4">
              <GitFork aria-hidden="true" className="text-primary" />
              <div className="grid gap-1">
                <p className="font-semibold">내 저장소 연결하기</p>
                <p className="text-small text-muted-foreground">
                  기존 GitHub 저장소 주소를 제출해 프로그램에 연결합니다.
                </p>
              </div>
            </CardContent>
          </Card>
          <Alert className="sm:col-span-2">
            <LockKeyhole aria-hidden="true" />
            <AlertDescription>
              외부 저장소는 공개 저장소만 연결
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <p className="text-small text-muted-foreground">
          신청서에서 저장소 발급 방식을 묻지 않습니다.
        </p>
      )}
    </div>
  );
}
