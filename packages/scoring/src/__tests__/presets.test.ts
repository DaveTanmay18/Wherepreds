import { describe, expect, it } from 'vitest';
import { collectFactPaths, collectRuleIds, POSITIONAL_FACTS, ruleSetConfigSchema } from '../dsl.js';
import { instantiatePreset, PRESET_LIST, PRESETS } from '../presets.js';

describe('presets', () => {
  it.each(PRESET_LIST)('$name is a valid rule set', (preset) => {
    const result = ruleSetConfigSchema.safeParse(preset.config);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it.each(PRESET_LIST)('$name has unique rule ids', (preset) => {
    const ids = collectRuleIds(preset.config);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('instantiates a DEEP copy so editing a league cannot mutate the preset', () => {
    const a = instantiatePreset('classic');
    a.awards[0]!.points = 999;
    const b = instantiatePreset('classic');
    expect(b.awards[0]!.points).toBe(5);
    expect(PRESETS.classic.config.awards[0]!.points).toBe(5);
  });

  it('keeps exact score and correct result mutually exclusive', () => {
    // Both sit in the "result" group, so only the higher may ever fire. If
    // these ever stack, every Classic league silently pays 7 for an exact
    // score instead of 5 — wrong in a way that looks entirely plausible.
    const classic = PRESETS.classic.config;
    const exact = classic.awards.find((a) => a.id === 'exact_score');
    const outcome = classic.awards.find((a) => a.id === 'correct_outcome');
    expect(exact?.group).toBe('result');
    expect(outcome?.group).toBe('result');
    expect(exact!.points).toBeGreaterThan(outcome!.points);
  });

  it('marks goal difference as stacking, not exclusive', () => {
    const gd = PRESETS.classic.config.awards.find((a) => a.id === 'goal_difference');
    expect(gd?.group).toBeNull();
  });

  it('rejects a config with an unknown fact path', () => {
    const bad = structuredClone(PRESETS.classic.config) as unknown as {
      awards: { when: unknown }[];
    };
    bad.awards[0]!.when = { fact: 'derived.nonsense', op: 'eq', value: true };
    expect(ruleSetConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects more than six markets', () => {
    const bad = { ...PRESETS.classic.config, markets: new Array(7).fill('EXACT_SCORE') };
    expect(ruleSetConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('flags the Underdog preset as depending on positional facts', () => {
    // Positional facts are null in knockout rounds, so a UCL league on this
    // preset needs the P4b-07 warning. Asserting it here means the warning
    // has something real to fire on.
    const facts = collectFactPaths(PRESETS.underdog.config);
    expect(facts.some((f) => POSITIONAL_FACTS.includes(f))).toBe(true);
  });

  it('Classic has no positional dependency, so it is knockout-safe', () => {
    const facts = collectFactPaths(PRESETS.classic.config);
    expect(facts.some((f) => POSITIONAL_FACTS.includes(f))).toBe(false);
  });
});
