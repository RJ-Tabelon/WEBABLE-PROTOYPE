import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * A local stand-in for the Supabase project, so the signed-in pages can be
 * captured without signing in to the hosted project and with the same data
 * on every run. The capture build of the web app points at it
 * (NEXT_PUBLIC_SUPABASE_URL), and nothing here ever reaches the network.
 *
 * It serves the small subset the web app uses:
 *   Auth      POST /auth/v1/token (password, refresh_token), GET/PUT /auth/v1/user,
 *             POST /auth/v1/logout, /signup, /recover, /otp, /verify
 *   REST      GET/PATCH/POST/DELETE /rest/v1/<table> with eq/neq/gt/gte/lt/lte/in/is
 *             filters, select, order and limit; object responses for .single()
 *   RPC       POST /rest/v1/rpc/<fn> (export_my_data, save_fit_profile, the rest no-ops)
 *   Functions POST /functions/v1/extension-link
 *
 * Tokens are HS256 JWTs, so supabase-js verifies them by calling GET /user
 * here (getClaims falls back to the Auth server for symmetric keys).
 *
 * Scenarios (POST /__stub/scenario {"name": ...}):
 *   full  a connected account with two fits, two weeks of activity, a learned
 *         state and one install (the e2e seeds: measuredFit, THIS_WEEK, ...)
 *   new   a new account: no fit, no activity, nothing learned, no installs
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function read(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** PostgREST filter value: eq.x, in.(a,b), is.null, ... */
function parseFilter(raw) {
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  let op = raw.slice(0, dot);
  let value = raw.slice(dot + 1);
  let negate = false;
  if (op === 'not') {
    const next = value.indexOf('.');
    op = value.slice(0, next);
    value = value.slice(next + 1);
    negate = true;
  }
  return { op, value, negate };
}

function coerce(cell, value) {
  if (typeof cell === 'boolean') return value === 'true';
  if (typeof cell === 'number') return Number(value);
  return value;
}

function matches(row, column, filter) {
  const cell = row[column];
  const { op, value } = filter;
  let result;
  switch (op) {
    case 'eq':
      result = cell === coerce(cell, value);
      break;
    case 'neq':
      result = cell !== coerce(cell, value);
      break;
    case 'gt':
      result = cell > coerce(cell, value);
      break;
    case 'gte':
      result = cell >= coerce(cell, value);
      break;
    case 'lt':
      result = cell < coerce(cell, value);
      break;
    case 'lte':
      result = cell <= coerce(cell, value);
      break;
    case 'in': {
      const list = value
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((v) => v.replace(/^"|"$/g, ''));
      result = list.map((v) => coerce(cell, v)).includes(cell);
      break;
    }
    case 'is':
      result =
        value === 'null'
          ? cell === null || cell === undefined
          : cell === (value === 'true');
      break;
    default:
      result = true;
  }
  return filter.negate ? !result : result;
}

const RESERVED = new Set([
  'select',
  'order',
  'limit',
  'offset',
  'on_conflict',
  'columns',
]);

function query(rows, params) {
  let out = rows.filter((row) => {
    for (const [key, raw] of params) {
      if (RESERVED.has(key)) continue;
      const filter = parseFilter(raw);
      if (filter && !matches(row, key, filter)) return false;
    }
    return true;
  });
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((part) => {
      const [col, dir] = part.split('.');
      return { col, desc: dir === 'desc' };
    });
    out = [...out].sort((a, b) => {
      for (const { col, desc } of keys) {
        if (a[col] === b[col]) continue;
        const cmp = a[col] > b[col] ? 1 : -1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.get('limit');
  out = out.slice(offset, limit ? offset + Number(limit) : undefined);
  return out;
}

function project(row, select) {
  if (!select || select.trim() === '*') return { ...row };
  const out = {};
  for (const col of select.split(',').map((c) => c.trim())) {
    if (col) out[col] = row[col] ?? null;
  }
  return out;
}

/**
 * @param {{ port: number, fixtures: any, now?: Date }} options
 */
export async function startSupabaseStub({ port, fixtures, now = new Date() }) {
  const secret = randomBytes(32);
  const user = {
    id: '6f1c2b1e-4c1a-4b8e-9a51-0c2a7f3d9e10',
    email: 'alex@example.com',
  };
  // A throwaway password for the stub account only, new on every run.
  const password = `stub-${randomBytes(12).toString('hex')}`;
  const iso = (msAgo) => new Date(now.getTime() - msAgo).toISOString();
  const DAY = 86_400_000;

  const db = {};
  const refreshTokens = new Set();

  function scenario(name) {
    const full = name !== 'new';
    db.accounts = [
      {
        user_id: user.id,
        onboarding_step: full ? 'connected' : 'new',
        cloud_analysis: false,
        product_learning: false,
        theme: 'system',
        created_at: iso(40 * DAY),
        updated_at: iso(2 * DAY),
      },
    ];
    const current = fixtures.measuredFit(now);
    const earlier = fixtures.earlierFit(now);
    db.fit_profiles = full
      ? [
          {
            id: randomUUID(),
            user_id: user.id,
            version: 1,
            profile: earlier,
            source: 'calibration',
            derivation_version: earlier.derivationVersion,
            calibration_session_id: null,
            is_current: false,
            created_at: iso(21 * DAY),
          },
          {
            id: randomUUID(),
            user_id: user.id,
            version: 2,
            profile: current,
            source: 'recalibration',
            derivation_version: current.derivationVersion,
            calibration_session_id: null,
            is_current: true,
            created_at: iso(2 * DAY),
          },
        ]
      : [];
    db.weekly_activity = full
      ? fixtures
          .weeklyActivityRows(now)
          .map((row) => ({ user_id: user.id, ...row }))
      : [];
    db.learning_state = full
      ? [
          {
            user_id: user.id,
            state: fixtures.learningState(now),
            rev: 3,
            engine_version: 'capture',
            updated_at: iso(3 * 3_600_000),
          },
        ]
      : [];
    db.extension_installs = full
      ? [
          {
            id: 'b7d1e2f3-0a4b-4c5d-8e9f-a0b1c2d3e4f5',
            user_id: user.id,
            browser: 'chrome',
            platform: 'mac',
            extension_version: '0.1.0',
            connected_at: iso(12 * DAY),
            last_seen_at: iso(20 * 60_000),
          },
        ]
      : [];
    db.calibration_sessions = [];
  }
  scenario('full');

  function jwt() {
    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        aud: 'authenticated',
        exp: iat + 7 * 24 * 3600,
        iat,
        iss: `http://127.0.0.1:${port}/auth/v1`,
        sub: user.id,
        email: user.email,
        phone: '',
        role: 'authenticated',
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: iat }],
        session_id: randomUUID(),
        is_anonymous: false,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
      }),
    );
    const sig = b64url(
      createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
    );
    return `${header}.${payload}.${sig}`;
  }

  function verified(req) {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.replace(/^Bearer\s+/i, '');
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const expected = b64url(
      createHmac('sha256', secret).update(`${h}.${p}`).digest(),
    );
    if (expected !== s) return false;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return claims.exp * 1000 > Date.now();
  }

  function userJson() {
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: iso(40 * DAY),
      phone: '',
      confirmed_at: iso(40 * DAY),
      last_sign_in_at: iso(0),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: iso(40 * DAY),
      updated_at: iso(0),
      is_anonymous: false,
    };
  }

  function session() {
    const refresh = randomBytes(16).toString('hex');
    refreshTokens.add(refresh);
    const expiresIn = 7 * 24 * 3600;
    return {
      access_token: jwt(),
      token_type: 'bearer',
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      refresh_token: refresh,
      user: userJson(),
    };
  }

  const authError = (res, status, code, msg) =>
    send(res, status, { code: status, error_code: code, msg });

  async function auth(req, res, url, body) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    if (path === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        if (
          String(body?.email ?? '').toLowerCase() === user.email &&
          body?.password === password
        )
          return send(res, 200, session());
        return authError(
          res,
          400,
          'invalid_credentials',
          'Invalid login credentials',
        );
      }
      if (grant === 'refresh_token') {
        if (refreshTokens.has(body?.refresh_token))
          return send(res, 200, session());
        return authError(
          res,
          400,
          'refresh_token_not_found',
          'Invalid Refresh Token',
        );
      }
      return authError(res, 400, 'validation_failed', 'Unsupported grant');
    }
    if (path === '/user' && (req.method === 'GET' || req.method === 'PUT')) {
      if (!verified(req)) return authError(res, 401, 'bad_jwt', 'invalid JWT');
      return send(res, 200, userJson());
    }
    if (path === '/logout') return send(res, 204);
    if (path === '/signup')
      return send(res, 200, {
        ...userJson(),
        id: randomUUID(),
        email: String(body?.email ?? ''),
        email_confirmed_at: null,
        confirmed_at: null,
        confirmation_sent_at: iso(0),
      });
    if (path === '/recover' || path === '/otp' || path === '/resend')
      return send(res, 200, {});
    if (path === '/verify') return send(res, 200, session());
    if (path === '/settings')
      return send(res, 200, {
        external: { email: true },
        disable_signup: false,
      });
    if (path === '/.well-known/jwks.json') return send(res, 200, { keys: [] });
    return authError(res, 404, 'not_found', 'Not found');
  }

  async function rest(req, res, url, body) {
    if (!verified(req))
      return send(res, 401, {
        code: 'PGRST301',
        message: 'JWT invalid',
        details: null,
        hint: null,
      });
    const rpc = /^\/rest\/v1\/rpc\/([\w-]+)$/.exec(url.pathname);
    if (rpc) {
      const fn = rpc[1];
      if (fn === 'export_my_data')
        return send(res, 200, {
          exported_at: new Date().toISOString(),
          account: db.accounts[0],
          fit_profiles: db.fit_profiles,
          weekly_activity: db.weekly_activity,
          learning_state: db.learning_state,
          extension_installs: db.extension_installs,
        });
      if (fn === 'save_fit_profile') {
        for (const row of db.fit_profiles) row.is_current = false;
        const version =
          Math.max(0, ...db.fit_profiles.map((r) => r.version)) + 1;
        const row = {
          id: randomUUID(),
          user_id: user.id,
          version,
          profile: body?.p_profile ?? null,
          source: body?.p_source ?? 'calibration',
          derivation_version: body?.p_derivation_version ?? '',
          calibration_session_id: null,
          is_current: true,
          created_at: new Date().toISOString(),
        };
        db.fit_profiles.push(row);
        return send(res, 200, row);
      }
      return send(res, 200, null);
    }
    const table = /^\/rest\/v1\/([\w-]+)$/.exec(url.pathname)?.[1];
    if (!table || !db[table])
      return send(res, 404, {
        code: '42P01',
        message: `relation "${table}" does not exist`,
        details: null,
        hint: null,
      });
    const params = url.searchParams;
    const select = params.get('select');
    const wantsObject = String(req.headers.accept ?? '').includes(
      'vnd.pgrst.object',
    );
    const representation = String(req.headers.prefer ?? '').includes(
      'return=representation',
    );
    let rows;
    if (req.method === 'GET' || req.method === 'HEAD') {
      rows = query(db[table], params);
    } else if (req.method === 'PATCH') {
      rows = query(db[table], params);
      for (const row of rows) Object.assign(row, body ?? {});
    } else if (req.method === 'POST') {
      const items = Array.isArray(body) ? body : [body ?? {}];
      rows = items.map((item) => ({
        id: randomUUID(),
        user_id: user.id,
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        calibration_version: 'capture',
        status: 'in_progress',
        ...item,
      }));
      db[table].push(...rows);
    } else if (req.method === 'DELETE') {
      rows = query(db[table], params);
      db[table] = db[table].filter((row) => !rows.includes(row));
    } else {
      return send(res, 405, { message: 'Method not allowed' });
    }
    if (req.method !== 'GET' && !representation) return send(res, 204);
    const out = rows.map((row) => project(row, select));
    if (wantsObject) {
      if (out.length !== 1)
        return send(res, 406, {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${out.length} rows`,
          hint: null,
        });
      return send(res, 200, out[0]);
    }
    return send(res, 200, out, {
      'content-range': `0-${Math.max(0, out.length - 1)}/${out.length}`,
    });
  }

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const raw = await read(req);
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      if (url.pathname === '/__stub/health')
        return send(res, 200, { ok: true });
      if (url.pathname === '/__stub/scenario' && req.method === 'POST') {
        scenario(String(body?.name ?? 'full'));
        return send(res, 200, { ok: true, scenario: body?.name ?? 'full' });
      }
      if (url.pathname.startsWith('/auth/v1')) return auth(req, res, url, body);
      if (url.pathname.startsWith('/rest/v1')) return rest(req, res, url, body);
      if (url.pathname === '/functions/v1/extension-link') {
        if (!verified(req)) return send(res, 401, { error: 'unauthorized' });
        return send(res, 200, {
          tokenHash: randomBytes(24).toString('hex'),
          email: user.email,
        });
      }
      return send(res, 404, { message: 'Not found' });
    })().catch((error) => {
      send(res, 500, { message: String(error?.message ?? error) });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}`,
    user,
    password,
    async setScenario(name) {
      scenario(name);
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
