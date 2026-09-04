import type { ProviderCapabilities } from '@wp/shared/env';
import type { Logger } from '../../logger.js';
import type {
  FootballProvider,
  ListMatchesOptions,
  RawCompetition,
  RawMatch,
  RawPerson,
  RawScorer,
  RawStandingGroup,
  RawTeam,
} from '../types.js';
import { FootballDataClient } from './client.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export class FootballDataOrgProvider implements FootballProvider {
  readonly name = 'football-data-org';

  constructor(
    private readonly client: FootballDataClient,
    readonly capabilities: ProviderCapabilities,
  ) {}

  static create(opts: {
    baseUrl: string;
    token: string;
    rateLimitPerMin: number;
    capabilities: ProviderCapabilities;
    log: Logger;
  }): FootballDataOrgProvider {
    return new FootballDataOrgProvider(
      new FootballDataClient({
        baseUrl: opts.baseUrl,
        token: opts.token,
        rateLimitPerMin: opts.rateLimitPerMin,
        log: opts.log,
      }),
      opts.capabilities,
    );
  }

  getCompetition(code: string): Promise<RawCompetition> {
    return this.client.get<RawCompetition>(`/competitions/${code}`);
  }

  async listTeams(competitionCode: string, season?: number): Promise<RawTeam[]> {
    const res = await this.client.get<{ teams: RawTeam[] }>(
      `/competitions/${competitionCode}/teams`,
      { season },
    );
    return res.teams ?? [];
  }

  getTeam(teamExtId: string | number): Promise<RawTeam> {
    return this.client.get<RawTeam>(`/teams/${teamExtId}`);
  }

  getPerson(personExtId: string | number): Promise<RawPerson> {
    return this.client.get<RawPerson>(`/persons/${personExtId}`);
  }

  /**
   * ONE call across every requested competition. This is the whole reason the
   * live poller fits a 10 calls/min budget: ten simultaneous matches cost one
   * request, not ten (§11.2).
   */
  async listMatches(opts: ListMatchesOptions): Promise<RawMatch[]> {
    const params: Record<string, string | number | undefined> = {
      competitions: opts.competitions?.join(','),
      season: opts.season,
      matchday: opts.matchday,
      status: opts.status?.join(','),
      dateFrom: opts.dateFrom ? iso(opts.dateFrom) : undefined,
      dateTo: opts.dateTo ? iso(opts.dateTo) : undefined,
      ids: opts.ids?.join(','),
    };

    // The cross-competition /matches endpoint rejects a season filter, so a
    // season-scoped query must go through the competition sub-resource.
    if (opts.season !== undefined && opts.competitions?.length === 1) {
      const res = await this.client.get<{ matches: RawMatch[] }>(
        `/competitions/${opts.competitions[0]}/matches`,
        { season: opts.season, matchday: opts.matchday, status: params.status },
      );
      return res.matches ?? [];
    }

    delete params.season;
    const res = await this.client.get<{ matches: RawMatch[] }>('/matches', params);
    return res.matches ?? [];
  }

  getMatch(matchExtId: string | number): Promise<RawMatch> {
    return this.client.get<RawMatch>(`/matches/${matchExtId}`);
  }

  async getStandings(competitionCode: string, season?: number): Promise<RawStandingGroup[]> {
    const res = await this.client.get<{ standings: RawStandingGroup[] }>(
      `/competitions/${competitionCode}/standings`,
      { season },
    );
    return res.standings ?? [];
  }

  async getScorers(competitionCode: string, season?: number, limit = 100): Promise<RawScorer[]> {
    const res = await this.client.get<{ scorers: RawScorer[] }>(
      `/competitions/${competitionCode}/scorers`,
      { season, limit },
    );
    return res.scorers ?? [];
  }
}
