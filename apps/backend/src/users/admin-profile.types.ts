export type AdminProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type AdminProfileUpdateCommand = {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
};

export type AdminProfileUpdateResult = AdminProfileFields & {
  readonly id: string;
};
