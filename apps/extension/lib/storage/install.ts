import type { KvArea } from './area';
import { base64url, randomBytes } from './crypto';
import { KEYS } from './keys';
import { isRecord, JsonStore } from './store';

/**
 * The install identity: a random id (the `extension_installs` primary key,
 * never a device identifier) and a 256-bit secret that keys every HMAC. Both
 * are generated once and survive updates; "clear local data" rotates the secret.
 */
export interface Install {
  id: string;
  secret: string;
  createdAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function parse(raw: unknown): Install | null {
  if (!isRecord(raw)) return null;
  const { id, secret, createdAt } = raw;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof secret !== 'string' || !SECRET.test(secret)) return null;
  return {
    id,
    secret,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

export function freshSecret(): string {
  return base64url(randomBytes(32));
}

export class InstallStore {
  private readonly store: JsonStore<Install | null>;
  private cached: Install | null = null;

  constructor(
    area: KvArea,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new JsonStore(area, KEYS.install, parse);
  }

  /** The install identity, generating it exactly once. */
  async get(): Promise<Install> {
    if (this.cached) return this.cached;
    const value = await this.store.update((cur) => {
      if (cur) return cur;
      return {
        id: crypto.randomUUID(),
        secret: freshSecret(),
        createdAt: this.now(),
      };
    });
    if (!value) throw new Error('install identity unavailable');
    this.cached = value;
    return value;
  }

  /** New secret, same id: every HMAC-keyed record becomes unreachable. */
  async rotateSecret(): Promise<Install> {
    const value = await this.store.update((cur) => ({
      id: cur?.id ?? crypto.randomUUID(),
      secret: freshSecret(),
      createdAt: cur?.createdAt ?? this.now(),
    }));
    if (!value) throw new Error('install identity unavailable');
    this.cached = value;
    return value;
  }
}
