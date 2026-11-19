import { z } from 'zod';

/**
 * Public configuration, validated once. Only NEXT_PUBLIC_* values live here:
 * they are inlined into the client bundle, so nothing secret may ever be added.
 *
 * Each variable is read as a literal `process.env.NEXT_PUBLIC_*` expression,
 * which is what lets Next.js inline it at build time.
 */

const EXTENSION_ID = /^[a-p]{32}$/;

const originSchema = z
  .url({ protocol: /^https?$/ })
  .transform((value) => new URL(value).origin);

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: originSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(20),
  NEXT_PUBLIC_WEB_ORIGIN: originSchema,
  NEXT_PUBLIC_EXTENSION_ID: z
    .string()
    .trim()
    .regex(EXTENSION_ID)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  NEXT_PUBLIC_CONTACT_EMAIL: z
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export interface PublicEnv {
  /** Supabase project origin, e.g. https://<ref>.supabase.co */
  supabaseUrl: string;
  /** Publishable (or legacy anon) key. Safe in the browser; RLS protects the data. */
  supabaseKey: string;
  /** Origin of this web app, used to build email redirect links. */
  webOrigin: string;
  /** Chrome extension id for externally_connectable messaging, when configured. */
  extensionId: string | null;
  /**
   * The team's support address. Required in production (every document page
   * links to it); development falls back to the issue tracker
   * (components/site/contact.ts).
   */
  contactEmail: string | null;
}

export class PublicEnvError extends Error {
  readonly variables: string[];
  constructor(variables: string[]) {
    super(
      `Invalid or missing environment: ${variables.join(', ')}. ` +
        'Run `pnpm env:sync` to write apps/web/.env.local from the root .env' +
        (variables.includes('NEXT_PUBLIC_CONTACT_EMAIL')
          ? ' (set CONTACT_EMAIL there: production builds link to it from every document page).'
          : '.'),
    );
    this.name = 'PublicEnvError';
    this.variables = variables;
  }
}

type RawPublicEnv = Partial<
  Record<keyof z.input<typeof publicEnvSchema>, string | undefined>
>;

/**
 * Parse raw values. Exported for tests and build-time checks; app code
 * calls getPublicEnv(). A production build without NEXT_PUBLIC_CONTACT_EMAIL
 * fails here rather than ship pages with no way to reach the team.
 */
export function parsePublicEnv(
  raw: RawPublicEnv,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  const variables = result.success
    ? []
    : result.error.issues.map((issue) => String(issue.path[0] ?? 'env'));
  if (nodeEnv === 'production' && !raw.NEXT_PUBLIC_CONTACT_EMAIL?.trim())
    variables.push('NEXT_PUBLIC_CONTACT_EMAIL');
  if (!result.success || variables.length > 0)
    throw new PublicEnvError([...new Set(variables)]);
  const env = result.data;
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    webOrigin: env.NEXT_PUBLIC_WEB_ORIGIN,
    extensionId: env.NEXT_PUBLIC_EXTENSION_ID ?? null,
    contactEmail: env.NEXT_PUBLIC_CONTACT_EMAIL ?? null,
  };
}

let cached: PublicEnv | null = null;

/** The validated public environment. Throws PublicEnvError with the variable names only. */
export function getPublicEnv(): PublicEnv {
  cached ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_WEB_ORIGIN: process.env.NEXT_PUBLIC_WEB_ORIGIN,
    NEXT_PUBLIC_EXTENSION_ID: process.env.NEXT_PUBLIC_EXTENSION_ID,
    NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  });
  return cached;
}
