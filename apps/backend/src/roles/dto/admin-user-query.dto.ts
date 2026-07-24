import { Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { AdminUserListQuery } from '../domain/admin-user';

export class AdminUserQueryRequestDto {
  @IsOptional()
  @IsString()
  declare readonly query?: string;

  @IsOptional()
  @IsEnum(Role)
  declare readonly role?: Role;

  toQuery(): AdminUserListQuery {
    return { query: this.query?.trim() ?? '', role: this.role };
  }
}
