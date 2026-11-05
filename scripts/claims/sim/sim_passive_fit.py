# Passive fit simulation (signals brief, round 4). A simulation of the update rule, not people.
#   python3 -I scripts/claims/sim/sim_passive_fit.py      (standard library only; about 3 s)
# Quoted in docs/CLAIMS.md. It models the "now" layer only: no 14-day decay and no ">= 3 sites on >= 2 days" rule,
# so "act" here is the probability threshold alone; the product also needs the multi-day rule before a default.
# Sim: binary-need log-odds update for click stabilisation using Hurst 2008 per-click error rates.
# need: p_err=0.283, typical: p_err=0.063. LLR per error/clean click; clamp; act at P>=0.9, offer at P>=0.7.
import math, random, statistics
random.seed(7)
P1, P0 = 0.283, 0.063
LE, LC = math.log(P1/P0), math.log((1-P1)/(1-P0))
logit = lambda p: math.log(p/(1-p))
L0 = logit(0.10)
def run(p_err, n=1000, clamp=(-4.0, 4.0), page=40, page_cap=2.0):
    L = L0; first_offer = first_act = None
    for i in range(n):
        if i % page == 0: page_sum = 0.0
        d = LE if random.random() < p_err else LC
        d = max(-page_cap - page_sum, min(page_cap - page_sum, d)) if abs(page_sum + d) > page_cap else d
        page_sum += d
        L = max(clamp[0], min(clamp[1], L + d))
        if first_offer is None and L >= logit(0.7): first_offer = i + 1
        if first_act is None and L >= logit(0.9): first_act = i + 1
    return first_offer, first_act
for label, p in [('need 28.3%', P1), ('typical 6.3%', P0), ('typical bad day 10%', 0.10), ('borderline 15%', 0.15)]:
    res = [run(p) for _ in range(4000)]
    offers = [r[0] for r in res if r[0]]; acts = [r[1] for r in res if r[1]]
    print(f"{label:22s} P(offer in 1000 clicks)={len(offers)/len(res):.3f} median clicks to offer={statistics.median(offers) if offers else None} "
          f"P(act)={len(acts)/len(res):.3f} median to act={statistics.median(acts) if acts else None}")
print('LLR error', round(LE,3), 'LLR clean', round(LC,3))
