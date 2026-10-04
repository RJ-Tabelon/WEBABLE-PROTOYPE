import type { Enums, Tables } from '@webable/core';
import { z } from 'zod';

import {
  type DataResult,
  fail,
  guarded,
  issuePaths,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

export type OnboardingStep = Enums<'onboarding_step'>;
export type ThemePreference = 'system' | 'light' | 'dark';

export const ONBOARDING_STEPS = [
  'new',
  'tuning',
  'tuned',
  'connected',
] as const satisfies readonly OnboardingStep[];
export const THEME_PREFERENCES = [
  'system',
  'light',
  'dark',
] as const satisfies readonly ThemePreference[];

/** Per-person settings and consents. Holds no health information. */
export interface Account {
  onboardingStep: OnboardingStep;
  /** Consent to send vocabulary-filtered page structure for analysis. Off by default. */
  cloudAnalysis: boolean;
  /** Consent to contribute randomized, anonymous outcome counts. Off by default. */
  productLearning: boolean;
  theme: ThemePreference;
  /** When the person last chose a theme explicitly (the most recent choice wins). */
  themeSetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ACCOUNT_COLUMNS =
  'onboarding_step, cloud_analysis, product_learning, theme, theme_set_at, created_at, updated_at' as const;

type AccountRow = Pick<
  Tables<'accounts'>,
  | 'onboarding_step'
  | 'cloud_analysis'
  | 'product_learning'
  | 'theme'
  | 'theme_set_at'
  | 'created_at'
  | 'updated_at'
>;

function isTheme(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function toAccount(row: AccountRow): Account {
  return {
    onboardingStep: row.onboarding_step,
    cloudAnalysis: row.cloud_analysis,
    productLearning: row.product_learning,
    theme: isTheme(row.theme) ? row.theme : 'system',
    themeSetAt: row.theme_set_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAccount(): Promise<DataResult<Account>> {
  return guarded('getAccount', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return fail('not_found');
    return ok(toAccount(data));
  });
}

export const accountPatchSchema = z
  .strictObject({
    cloudAnalysis: z.boolean().optional(),
    productLearning: z.boolean().optional(),
    theme: z.enum(THEME_PREFERENCES).optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      error: 'Nothing to update.',
    },
  );

export type AccountPatch = z.input<typeof accountPatchSchema>;

/** Change consents or theme. Onboarding moves only through advanceOnboarding(). */
export async function updateAccount(
  patch: AccountPatch,
): Promise<DataResult<Account>> {
  const parsed = accountPatchSchema.safeParse(patch);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));

  return guarded('updateAccount', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const update: {
      cloud_analysis?: boolean;
      product_learning?: boolean;
      theme?: ThemePreference;
      theme_set_at?: string;
    } = {};
    if (parsed.data.cloudAnalysis !== undefined)
      update.cloud_analysis = parsed.data.cloudAnalysis;
    if (parsed.data.productLearning !== undefined)
      update.product_learning = parsed.data.productLearning;
    if (parsed.data.theme !== undefined) {
      update.theme = parsed.data.theme;
      update.theme_set_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(update)
      .eq('user_id', user.id)
      .select(ACCOUNT_COLUMNS)
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return fail('not_found');
    return ok(toAccount(data));
  });
}

/**
 * Move onboarding forward (new -> tuning -> tuned -> connected), never back.
 * Atomic: the update only matches rows still at an earlier step. Returns the
 * step the account is at afterwards.
 */
export async function advanceOnboarding(
  step: OnboardingStep,
): Promise<DataResult<{ onboardingStep: OnboardingStep }>> {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index < 0) return fail('invalid_input', ['step']);

  return guarded('advanceOnboarding', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const earlier = ONBOARDING_STEPS.slice(0, index);
    if (earlier.length > 0) {
      const { error } = await supabase
        .from('accounts')
        .update({ onboarding_step: step })
        .eq('user_id', user.id)
        .in('onboarding_step', earlier);
      if (error) return fail(mapPostgrestError(error));
    }

    const { data, error } = await supabase
      .from('accounts')
      .select('onboarding_step')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return fail(mapPostgrestError(error));
    if (!data) return fail('not_found');
    return ok({ onboardingStep: data.onboarding_step });
  });
}
