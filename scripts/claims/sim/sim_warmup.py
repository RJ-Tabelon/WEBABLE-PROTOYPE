"""Monte Carlo for the 75-second warm-up fitting (round 4, KEY fitting; sim_warmup2.py in the brief).
Compares the proposed early-stopping rules with the current rules on simulated people.
Run: python3 -I scripts/claims/sim/sim_warmup.py   (needs numpy; a few minutes). Simulated people, not humans.
Quoted in docs/CLAIMS.md as simulation numbers only.
"""
import math
import numpy as np

rng = np.random.default_rng(11)

# ------------------------------------------------------------------ reading
# Person: true critical print size c (log10 CSS px of the stimulus font), max speed M (log10 wpm),
# slope s below the knee, per-sentence noise sd, lapse rate. "Can't read" below acuity a = c - reserve.
CHARS = 56
T0 = 0.6

def person_reading():
    c = rng.uniform(math.log10(10), math.log10(64))
    M = rng.normal(math.log10(240), 0.12)
    s = rng.uniform(1.8, 3.2)
    sd = rng.uniform(0.07, 0.15)
    reserve = rng.uniform(0.2, 0.35)
    return dict(c=c, M=M, s=s, sd=sd, a=c - reserve, lapse=0.03)

SMOOTH = True
def respond(p, x):
    """Returns (kind, rt_s, logwpm or None). kind: ok | wrong | cant."""
    if x < p['a']:
        return 'cant', 4.0, None
    if SMOOTH:  # exponential knee (Arango 2020 form); c is the 80%-of-max-speed size
        tau = (p['c'] - p['a']) / math.log(5)
        lin = 1 - math.exp(-(x - p['a'] + 1e-3) / tau)
        y = p['M'] + math.log10(max(lin, 0.05)) + rng.normal(0, p['sd'])
    else:
        y = p['M'] - p['s'] * max(0.0, p['c'] - x) + rng.normal(0, p['sd'])
    wpm = 10 ** y
    rt = T0 + (CHARS / 6) / (wpm / 60)
    # accuracy falls near acuity
    p_err = p['lapse'] + 0.35 * max(0.0, 1 - (x - p['a']) / 0.15)
    if rng.random() < p_err:
        return 'wrong', rt, None
    return 'ok', rt, y

C_GRID = np.arange(0.9, 2.15, 0.01)
M_GRID = np.arange(1.6, 2.9, 0.02)
CG, MG = np.meshgrid(C_GRID, M_GRID, indexing='ij')
S_FIX = 2.5
SD_FIX = 0.10

def bayes_reading(p, x0, xmin, xmax, prior_c=None, max_n=8, sd_stop=0.08, min_n=4, max_active=30.0):
    """Proposed: grid posterior over (c, M); next size maximises predictive information; early stop."""
    logpost = np.zeros_like(CG)
    if prior_c is not None:  # e.g. from Chrome's default font size; weak
        logpost += -0.5 * ((CG - prior_c) / 0.35) ** 2
    logpost += -0.5 * ((MG - math.log10(240)) / 0.25) ** 2
    cands = np.arange(xmin, xmax + 1e-9, 0.05)
    x = x0
    n, active = 0, 0.0
    practice = True
    while True:
        kind, rt, y = respond(p, x)
        active += rt
        if practice:  # the first sentence still informs M and c (it is at a large size)
            practice = False
        pred = MG - S_FIX * np.maximum(0.0, CG - x)
        if kind == 'ok':
            logpost += -0.5 * ((y - pred) / SD_FIX) ** 2
        elif kind == 'cant':
            # can't read: likely below acuity, i.e. x < c - 0.25 (soft)
            logpost += np.log(1 / (1 + np.exp(-(CG - 0.25 - x) / 0.05)) + 1e-6)
        else:  # wrong answer: weak evidence the size is near/below the knee
            logpost += np.log(0.5 + 0.5 / (1 + np.exp(-(CG - x) / 0.1)) + 1e-9)
        n += 1
        w = np.exp(logpost - logpost.max()); w /= w.sum()
        pc = w.sum(1)
        cm = float((C_GRID * pc).sum())
        csd = float(math.sqrt(((C_GRID - cm) ** 2 * pc).sum()))
        if (n >= min_n and csd < sd_stop) or n >= max_n or active >= max_active:
            return cm, n, active
        # next size: maximise 0.5*log(1 + Var_post[pred(x)] / sd^2)
        ok_c = cands[cands >= cm - 0.3]  # never probe far below the knee estimate ("can't read" streaks)
        pr = MG[None] - S_FIX * np.maximum(0.0, CG[None] - ok_c[:, None, None])
        m = (pr * w[None]).sum((1, 2))
        v = (((pr - m[:, None, None]) ** 2) * w[None]).sum((1, 2))
        x = float(ok_c[int(np.argmax(v))])

def ladder_reading(p, x0, xmin, max_n=9, max_active=35.0):
    """Current rule (ladder.ts phases A/B, simplified) + derive.ts plateau-80% CPS (first pass)."""
    trials = []
    x = x0
    phase = 'A'
    queue = []
    active = 0.0
    retested = False
    while True:
        kind, rt, y = respond(p, x)
        active += rt
        readable = kind == 'ok'
        prior = [t[1] for t in trials if t[1] is not None]
        maxy = max([y] + prior) if readable else (max(prior) if prior else -9)
        onp = readable and y >= maxy - 0.1
        trials.append((x, y if readable else None))
        if len(trials) >= max_n or active >= max_active:
            break
        if phase == 'A':
            if not readable and kind != 'cant' and not retested:
                retested = True; continue
            if onp:
                if x <= xmin + 1e-6: break
                x = max(x - 0.2, xmin); continue
            phase = 'B'
            prev = trials[-2] if len(trials) >= 2 else None
            if prev and prev[0] - x >= 0.15: queue.append(x + 0.1)
            if readable and x - 0.1 >= xmin: queue.append(x - 0.1)
            if not queue: break
            x = queue.pop(0); continue
        else:
            if not onp: break
            if not queue: break
            x = queue.pop(0)
    ys = [t[1] for t in trials if t[1] is not None]
    if not ys:
        return x0, len(trials), active
    ymax = max(ys)
    plateau = np.median([v for v in ys if v >= ymax - 0.15])
    thr = plateau - 0.097
    by = {}
    for tx, ty in trials:
        if ty is None: by.setdefault(tx, None); continue
        if by.get(tx) is None or ty > by[tx]: by[tx] = ty
    xp = None
    for tx in sorted(by, reverse=True):
        v = by[tx]
        if v is not None and v >= thr: xp = tx; continue
        if xp is not None: break
    return (xp if xp is not None else x0), len(trials), active

def reading_sim(reps=3000):
    rows = {}
    for name in ('current', 'proposed', 'proposed+prior', 'proposed min5'):
        err, ns, ts, diffs = [], [], [], []
        for _ in range(reps):
            p = person_reading()
            x0 = min(p['c'] + 0.3 + rng.uniform(-0.1, 0.25), 2.1)  # start well above the knee
            xmin = math.log10(9)
            prior = p['c'] + rng.normal(0, 0.3) if name == 'proposed+prior' else None
            def once():
                if name == 'current':
                    return ladder_reading(p, x0, xmin)
                return bayes_reading(p, x0, xmin, 2.1, prior_c=prior, min_n=5 if name=='proposed min5' else 4)
            e1, n1, t1 = once()
            e2, n2, t2 = once()
            err.append(e1 - p['c']); ns.append(n1 + 1); ts.append(t1 + 3.0)  # +1 practice sentence ~3 s
            diffs.append(e1 - e2)
        err = np.array(err); diffs = np.array(diffs)
        rows[name] = dict(
            sentences_mean=round(float(np.mean(ns)), 1), sentences_p90=int(np.percentile(ns, 90)),
            reading_s_median=round(float(np.median(ts)), 1),
            rmse_log=round(float(np.sqrt((err ** 2).mean())), 3), bias_log=round(float(err.mean()), 3),
            within_1_step=round(float((np.abs(err) <= 0.1).mean()), 3),
            retest_CoR_log=round(float(1.96 * diffs.std()), 3),
            retest_same_step=round(float((np.abs(diffs) <= 0.1).mean()), 3),
        )
    return rows

# ------------------------------------------------------------------ contrast (QUEST+, 4AFC)
BETA, GAMMA, LAM = 3.5, 0.25, 0.02

def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

grays = np.arange(89, 255).astype(float)
X = np.log10(1 - srgb_to_lin(grays))
A = np.arange(-2.3, -0.08, 0.02)

def pcf(x, a):
    return GAMMA + (1 - GAMMA - LAM) * (1 - np.exp(-10 ** (BETA * (x - a))))

PC = pcf(X[:, None], A[None, :])

def band(a):
    return 0 if a <= -1.52 else (1 if a <= -1.05 else 2)

def quest(true_a, max_q, sd_stop, mu=-1.4, sd=0.5):
    post = np.exp(-0.5 * ((A - mu) / sd) ** 2); post /= post.sum()
    n = 0
    # trial 0: easy, W = 0.5
    xi = int(np.argmin(abs(X - math.log10(0.5))))
    for t in range(max_q + 1):
        if t > 0:
            pcor = PC @ post
            pc_ = PC * post; pi_ = (1 - PC) * post
            def H(m):
                q = m / np.maximum(m.sum(1, keepdims=True), 1e-300)
                return -(q * np.log(np.maximum(q, 1e-300))).sum(1)
            xi = int(np.argmin(pcor * H(pc_) + (1 - pcor) * H(pi_)))
        ok = rng.random() < pcf(X[xi], true_a)
        post = post * (PC[xi] if ok else 1 - PC[xi]); post /= post.sum()
        n += 1
        m = float((A * post).sum()); s = float(math.sqrt(((A - m) ** 2 * post).sum()))
        bp = np.array([post[A <= -1.52].sum(), post[(A > -1.52) & (A <= -1.05)].sum(), post[A > -1.05].sum()])
        if t >= 3 and (s < sd_stop or bp.max() >= 0.85):
            break
    return m, n, bp

def contrast_sim(reps=3000):
    out = {}
    for label, mq, stop in (('current 1+6', 6, 0.12), ('proposed 1+4, stop', 4, 0.15), ('1+3 fixed', 3, 0.0)):
        for rule in ('mean', 'lean-up'):
          acc = under = over2 = same = 0; ns = []
          def dec(e, bp):
              if rule == 'mean': return band(e)
              # asymmetric: the strongest band whose upper-tail posterior is >= 0.35
              if bp[2] >= 0.35: return 2
              if bp[1] + bp[2] >= 0.35: return 1
              return 0
          for _ in range(reps):
            person = rng.uniform(-2.0, -0.5)
            disp = rng.normal(0, 0.10)
            e1, n1, b1 = quest(person + disp, mq, stop)
            e2, _, b2 = quest(person + disp, mq, stop)
            d1, d2 = dec(e1, b1), dec(e2, b2)
            acc += d1 == band(person); under += d1 < band(person); over2 += d1 - band(person) >= 2; same += d1 == d2
            ns.append(n1)
          out[label + ' ' + rule] = dict(trials_mean=round(float(np.mean(ns)), 2), band_acc=round(acc / reps, 3),
                          under_band=round(under / reps, 3), over_2bands=round(over2 / reps, 3), retest_same_band=round(same / reps, 3))
    return out

# ------------------------------------------------------------------ pointing
MOUSE = [24, 32, 44, 56, 72, 96]

def pmiss(L, sig):
    return math.exp(-L * L / (8 * sig * sig))

def true_level(sa, c):
    for L in MOUSE[:-1]:
        if pmiss(L, math.sqrt(sa ** 2 + (c * L) ** 2)) <= 0.08:
            return L
    return 96

def press(W, sa, c, lapse=0.04):
    sig = math.sqrt(sa ** 2 + (c * W) ** 2)
    dx, dy = rng.normal(0, sig, 2)
    if rng.random() < lapse:
        dx += rng.normal(0, 3 * W); dy += rng.normal(0, 3 * W)
    r = math.hypot(dx, dy)
    return r, r > W / 2

def spread_ok(W, rs):
    rr = [r for r in rs if r <= 2 * W]
    if not rr: return False
    sig = float(np.median(rr)) / 1.1774
    sabs = math.sqrt(max(0.0, sig ** 2 - (0.16 * W) ** 2))
    return pmiss(W, math.sqrt((1.15 * sabs) ** 2 + (0.16 * W) ** 2)) <= 0.08

def current_pointing(sa, c):
    idx = MOUSE.index(44); direction = None; res = {}; presses = 0
    for _ in range(3):
        W = MOUSE[idx]
        rs, ms = [], 0
        for _ in range(9):
            r, m = press(W, sa, c); presses += 1
            rs.append(r); ms += m
        rs = rs[1:]  # first press positions the pointer (miss count kept simple)
        ok = ms <= 1 and spread_ok(W, rs)
        res[W] = ok
        if direction is None: direction = -1 if ok else 1
        if (direction == -1 and not ok) or (direction == 1 and ok): break
        idx += direction
        if idx < 0 or idx >= len(MOUSE): break
    return pick(res), presses

def pick(res):
    failed = [w for w, ok in res.items() if not ok]
    mf = max(failed) if failed else -1
    passed = [w for w, ok in res.items() if ok and w > mf]
    if passed: return min(passed)
    above = [l for l in MOUSE if l > mf]
    return above[0] if above else 96

def proposed_pointing(sa, c, max_presses=18, need=4):
    """Sequential per size: pass after 4 clean scored presses + spread test; fail at 2 misses;
    otherwise up to 6 scored. Walk from 44 until the first reversal. First press of the
    block is unscored only for the very first size (pointer positioning)."""
    idx = MOUSE.index(44); direction = None; res = {}; presses = 0; first = True
    while presses < max_presses:
        W = MOUSE[idx]
        rs, ms, n = [], 0, 0
        if first:
            press(W, sa, c); presses += 1; first = False
        ok = None
        while presses < max_presses:
            r, m = press(W, sa, c); presses += 1; n += 1
            rs.append(r); ms += m
            if ms >= 2: ok = False; break
            if n >= need and ms == 0 and spread_ok(W, rs): ok = True; break
            if n >= 6: ok = ms <= 1 and spread_ok(W, rs); break
        if ok is None: break
        res[W] = ok
        if direction is None: direction = -1 if ok else 1
        if (direction == -1 and not ok) or (direction == 1 and ok): break
        idx += direction
        if idx < 0 or idx >= len(MOUSE): break
    return pick(res) if res else 56, presses

def proposed_pointing_up(sa, c):
    # need 5 clean; final answer goes one level up if the chosen level saw any miss
    S, p = proposed_pointing(sa, c, 20, 5)
    return S, p

def pointing_sim(reps=6000):
    lv = MOUSE.index
    out = {}
    for name, fn in (('current 3x(1+8)', current_pointing), ('proposed sequential need4', proposed_pointing), ('proposed need5', lambda a,b: proposed_pointing(a,b,20,5)), ('proposed need5 +1 level if 1 miss', lambda a,b: proposed_pointing_up(a,b))):
        ex = w1 = un = rt = 0; ps = []
        for _ in range(reps):
            sa = math.exp(rng.uniform(math.log(0.5), math.log(14)))
            c = rng.uniform(0.12, 0.20)
            t = true_level(sa, c)
            s1, p1 = fn(sa, c); s2, _ = fn(sa, c)
            d = lv(s1) - lv(t)
            ex += d == 0; w1 += abs(d) <= 1; un += d < 0; rt += abs(lv(s1) - lv(s2)) <= 1
            ps.append(p1)
        out[name] = dict(presses_mean=round(float(np.mean(ps)), 1), presses_p90=int(np.percentile(ps, 90)),
                         exact=round(ex / reps, 3), within1=round(w1 / reps, 3), under=round(un / reps, 3),
                         retest_within1=round(rt / reps, 3))
    return out

if __name__ == '__main__':
    import json
    print('READING', json.dumps(reading_sim(), indent=1))
    print('CONTRAST', json.dumps(contrast_sim(), indent=1))
    print('POINTING', json.dumps(pointing_sim(), indent=1))
