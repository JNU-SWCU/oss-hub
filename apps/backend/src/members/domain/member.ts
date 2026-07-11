export interface Member {
  id: string;
  email: string;
  nickname: string;
  createdAt: Date;
}

export interface MemberPage {
  items: Member[];
  total: number;
}
