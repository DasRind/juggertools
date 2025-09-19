import type { GameRecord, PlayerRef } from '@juggertools/core-domain';
import type {
  AnalyticsPlayerIndexEntry,
  AnalyticsSession,
  AnalyticsTeamIndexEntry,
} from '../types/analytics-session';

export function buildTeamIndex(games: GameRecord[]): Record<string, AnalyticsTeamIndexEntry> {
  const index: Record<string, AnalyticsTeamIndexEntry> = {};
  for (const game of games) {
    const add = (teamId: string) => {
      if (!index[teamId]) {
        index[teamId] = { gameIds: [] };
      }
      index[teamId].gameIds.push(game.id);
    };
    add(game.left.id);
    add(game.right.id);
  }
  return index;
}

export function buildPlayerIndex(games: GameRecord[]): Record<string, AnalyticsPlayerIndexEntry> {
  const index: Record<string, AnalyticsPlayerIndexEntry> = {};

  const remember = (player: PlayerRef, gameId: string) => {
    const entry = index[player.id];
    if (entry) {
      entry.gameIds.push(gameId);
    } else {
      index[player.id] = {
        teamId: player.teamId,
        gameIds: [gameId],
      };
    }
  };

  for (const game of games) {
    for (const player of game.players) {
      remember(player, game.id);
    }
  }

  return index;
}

export function ensureSessionIndexes(session: AnalyticsSession): AnalyticsSession {
  const teamIndex = buildTeamIndex(session.games);
  const playerIndex = buildPlayerIndex(session.games);
  return {
    ...session,
    teamIndex,
    playerIndex,
  };
}
