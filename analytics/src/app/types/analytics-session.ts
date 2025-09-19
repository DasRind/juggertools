import type { GameRecord } from '@juggertools/core-domain';

export interface AnalyticsTeamIndexEntry {
  gameIds: string[];
}

export interface AnalyticsPlayerIndexEntry {
  teamId: string;
  gameIds: string[];
}

export interface AnalyticsSession {
  games: GameRecord[];
  savedAt: string;
  teamIndex: Record<string, AnalyticsTeamIndexEntry>;
  playerIndex: Record<string, AnalyticsPlayerIndexEntry>;
}
