import type { ProviderCapabilities } from '@wp/shared/env';

/**
 * Provider-agnostic ingestion interface (architecture.md §11.1).
 *
 * Everything in this directory — and ONLY this directory — sees provider field
 * names. Raw* types below mirror football-data.org v4 exactly; the mapper
 * layer converts them to our domain. Swapping providers is a one-directory
 * change precisely because nothing outside imports these shapes.
 */

export type RawArea = { id: number; name: string; code?: string; flag?: string | null };

export type RawSeason = {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday: number | null;
  winner?: unknown;
};

export type RawCompetition = {
  id: number;
  area?: RawArea;
  name: string;
  code: string;
  type: string;
  emblem?: string | null;
  currentSeason?: RawSeason;
  seasons?: RawSeason[];
};

export type RawTeamRef = {
  id: number;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
};

export type RawPerson = {
  id: number;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  position?: string | null;
  shirtNumber?: number | null;
};

export type RawTeam = RawTeamRef & {
  area?: RawArea;
  address?: string | null;
  website?: string | null;
  founded?: number | null;
  clubColors?: string | null;
  venue?: string | null;
  squad?: RawPerson[];
  coach?: { id: number; name: string } | null;
};

/**
 * ⚠️ `score.fullTime` is regularTime + extraTime + penalties SUMMED. On a
 * shootout it reports a scoreline that never happened (§11.1). Only the mapper
 * may read it, and it doesn't — it reads regularTime. Verified 2026-08-18.
 */
export type RawScoreParts = { home: number | null; away: number | null };

export type RawScore = {
  winner: string | null;
  duration: string;
  fullTime: RawScoreParts;
  halfTime: RawScoreParts;
  regularTime?: RawScoreParts;
  extraTime?: RawScoreParts;
  penalties?: RawScoreParts;
};

export type RawGoal = {
  minute: number;
  injuryTime?: number | null;
  type?: string;
  team: RawTeamRef;
  scorer: RawPerson;
  assist?: RawPerson | null;
  score?: RawScoreParts;
};

export type RawBooking = {
  minute: number;
  team: RawTeamRef;
  player: RawPerson;
  card: string;
};

export type RawSubstitution = {
  minute: number;
  team: RawTeamRef;
  playerOut: RawPerson;
  playerIn: RawPerson;
};

export type RawMatchTeam = RawTeamRef & {
  coach?: { id: number | null; name: string | null } | null;
  formation?: string | null;
  lineup?: RawPerson[];
  bench?: RawPerson[];
  statistics?: Record<string, number | null> | null;
};

export type RawMatch = {
  id: number;
  utcDate: string;
  status: string;
  minute?: number | null;
  injuryTime?: number | null;
  attendance?: number | null;
  venue?: string | null;
  matchday: number | null;
  stage: string;
  group?: string | null;
  lastUpdated: string;
  competition?: { id: number; code: string };
  season?: RawSeason;
  homeTeam: RawMatchTeam;
  awayTeam: RawMatchTeam;
  score: RawScore;
  goals?: RawGoal[];
  bookings?: RawBooking[];
  substitutions?: RawSubstitution[];
  referees?: { id: number; name: string; type: string }[];
};

export type RawStandingEntry = {
  position: number;
  team: RawTeamRef;
  playedGames: number;
  form?: string | null;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
};

export type RawStandingGroup = {
  stage: string;
  type: string;
  group?: string | null;
  table: RawStandingEntry[];
};

export type RawScorer = {
  player: RawPerson;
  team: RawTeamRef;
  playedMatches: number;
  goals: number | null;
  assists: number | null;
  penalties: number | null;
};

export type ListMatchesOptions = {
  competitions?: string[];
  season?: number;
  matchday?: number;
  status?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  ids?: number[];
};

export interface FootballProvider {
  readonly name: string;
  /** What this provider + plan can supply. Drives market gating (§11.5). */
  readonly capabilities: ProviderCapabilities;

  getCompetition(code: string): Promise<RawCompetition>;
  listTeams(competitionCode: string, season?: number): Promise<RawTeam[]>;
  getTeam(teamExtId: string | number): Promise<RawTeam>;
  getPerson(personExtId: string | number): Promise<RawPerson>;

  /**
   * The workhorse. ONE call returns every matching match across all requested
   * competitions — which is what keeps the live poller inside a 10 calls/min
   * budget on a ten-match Saturday (§11.2).
   */
  listMatches(opts: ListMatchesOptions): Promise<RawMatch[]>;

  getMatch(matchExtId: string | number): Promise<RawMatch>;
  getStandings(competitionCode: string, season?: number): Promise<RawStandingGroup[]>;
  getScorers(competitionCode: string, season?: number, limit?: number): Promise<RawScorer[]>;
}
