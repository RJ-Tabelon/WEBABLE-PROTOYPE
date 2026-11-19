/** Build-time configuration read by the service worker and extension pages (WXT loads .env files). */
interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL?: string;
  readonly WXT_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The web app origin, for links ("Open your fit", "Connect"). */
  readonly WXT_WEB_ORIGIN?: string;
  /** Comma-separated externally_connectable match patterns (the bridge allowlist). */
  readonly WXT_WEB_ORIGINS?: string;
  /** Override for the decide Edge Function URL (local functions, e2e stub). */
  readonly WXT_DECIDE_URL?: string;
  /**
   * Override for the compose Edge Function URL: the local dev planner
   * (`pnpm dev:compose`) or the e2e stub. Development and e2e builds only;
   * production builds ignore it.
   */
  readonly WXT_COMPOSE_URL?: string;
}
