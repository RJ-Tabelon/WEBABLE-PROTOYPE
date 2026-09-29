/**
 * Test double for the Supabase server client (unit tests only; never imported by
 * app code). Query builders record every chained call and resolve to a result
 * queued per table, so tests can assert both behavior and the exact filters used.
 */

export interface Recorded {
  table: string;
  ops: Array<[method: string, ...args: unknown[]]>;
}

export interface Result {
  data: unknown;
  error: unknown;
}

type Handler = (...args: unknown[]) => Promise<unknown>;

export interface FakeSupabase {
  client: {
    from(table: string): unknown;
    rpc(fn: string, args?: unknown): Promise<Result>;
    auth: Record<string, Handler>;
    functions: { invoke: Handler };
  };
  /** Every from(...) chain, in order. */
  queries: Recorded[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  /** Calls to auth.* and functions.invoke, as [method, args]. */
  authCalls: Array<[string, unknown[]]>;
  /** Queue the result of the next from(table) chain. */
  queue(table: string, result: Partial<Result>): FakeSupabase;
  rpcResult(fn: string, result: Partial<Result>): FakeSupabase;
  /** Override an auth method (signInWithPassword, getClaims, ...). */
  onAuth(method: string, handler: Handler): FakeSupabase;
  onInvoke(handler: Handler): FakeSupabase;
}

function chain(record: Recorded, result: Result): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (
            resolve: (value: Result) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          record.ops.push([String(prop), ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/** A fake signed in as `userId` (or signed out when null). */
export function createFakeSupabase(
  userId: string | null = '11111111-1111-4111-8111-111111111111',
  email = 'person@example.com',
): FakeSupabase {
  const queued = new Map<string, Result[]>();
  const rpcResults = new Map<string, Result>();
  const authHandlers = new Map<string, Handler>();
  let invokeHandler: Handler = async () => ({ data: null, error: null });

  const fake: FakeSupabase = {
    queries: [],
    rpcCalls: [],
    authCalls: [],
    client: {
      from(table) {
        const record: Recorded = { table, ops: [] };
        fake.queries.push(record);
        const result = queued.get(table)?.shift() ?? {
          data: null,
          error: null,
        };
        return chain(record, result);
      },
      async rpc(fn, args) {
        fake.rpcCalls.push({ fn, args });
        return rpcResults.get(fn) ?? { data: null, error: null };
      },
      auth: new Proxy({} as Record<string, Handler>, {
        get(_target, prop: string) {
          return async (...args: unknown[]) => {
            fake.authCalls.push([prop, args]);
            const handler = authHandlers.get(prop);
            if (handler) return handler(...args);
            if (prop === 'getClaims') {
              return userId
                ? {
                    data: {
                      claims: { sub: userId, email, exp: 2_000_000_000 },
                    },
                    error: null,
                  }
                : { data: null, error: null };
            }
            return { data: {}, error: null };
          };
        },
      }),
      functions: {
        invoke: (...args: unknown[]) => {
          fake.authCalls.push(['functions.invoke', args]);
          return invokeHandler(...args);
        },
      },
    },
    queue(table, result) {
      const list = queued.get(table) ?? [];
      list.push({ data: result.data ?? null, error: result.error ?? null });
      queued.set(table, list);
      return fake;
    },
    rpcResult(fn, result) {
      rpcResults.set(fn, {
        data: result.data ?? null,
        error: result.error ?? null,
      });
      return fake;
    },
    onAuth(method, handler) {
      authHandlers.set(method, handler);
      return fake;
    },
    onInvoke(handler) {
      invokeHandler = handler;
      return fake;
    },
  };
  return fake;
}
