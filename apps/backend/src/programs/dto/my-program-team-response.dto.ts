import type { ProgramTeamView } from '../program-team-repository-evidence.repository';
import { ProgramTeamResponseDto } from './program-team-response.dto';

export class MyProgramTeamResponseDto {
  declare readonly membership: 'NONE' | 'MEMBER' | 'LEADER';
  declare readonly team: ProgramTeamResponseDto | null;

  static from(view: ProgramTeamView | null): MyProgramTeamResponseDto {
    if (view === null) {
      return { membership: 'NONE', team: null };
    }
    const team = ProgramTeamResponseDto.from(view);
    return { membership: team.isLeader ? 'LEADER' : 'MEMBER', team };
  }
}
