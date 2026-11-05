// R3 faint words: QUEST+ with a fixed slope picks the next gray level (fitting brief §3 R3).
// x = log10 Weber contrast of gray text on white. The page only records what was shown and whether
// the word was picked; core's deriveFit turns that into a contrast band.

const BETA = 3.5;
const GAMMA = 0.25;
const LAMBDA = 0.02;

export interface GrayStimulus {
  gray: number; // sRGB channel value 89..254
  weber: number; // 1 - L_text / L_white
  x: number; // log10 weber
  ratio: number; // WCAG contrast ratio against #FFF
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function grayStimulus(gray: number): GrayStimulus {
  const L = srgbToLinear(gray);
  const weber = 1 - L;
  return { gray, weber, x: Math.log10(weber), ratio: 1.05 / (L + 0.05) };
}

export const STIMULI: GrayStimulus[] = Array.from({ length: 254 - 89 + 1 }, (_, i) => grayStimulus(89 + i));

function pCorrect(x: number, alpha: number): number {
  return GAMMA + (1 - GAMMA - LAMBDA) * (1 - Math.exp(-(10 ** (BETA * (x - alpha)))));
}

function entropy(p: number[]): number {
  let h = 0;
  for (const v of p) if (v > 0) h -= v * Math.log(v);
  return h;
}

export interface FaintTrial {
  stim: GrayStimulus;
  correct: boolean;
}

export class FaintQuest {
  readonly trials: FaintTrial[] = [];
  private readonly alphas: number[] = [];
  private post: number[] = [];
  private questTrials = 0;
  private ceiling = 0;
  private finished = false;

  constructor(largePrint: boolean, private readonly maxQuest = 6) {
    const mu = largePrint ? -1.1 : -1.4;
    const sd = largePrint ? 0.6 : 0.5;
    for (let a = -2.3; a <= -0.1 + 1e-9; a += 0.02) this.alphas.push(Math.round(a * 100) / 100);
    this.post = this.alphas.map((a) => Math.exp(-0.5 * ((a - mu) / sd) ** 2));
    this.normalize();
  }

  get done(): boolean {
    return this.finished;
  }

  progress(): number {
    return this.finished ? 1 : Math.min(0.95, this.trials.length / (this.maxQuest + 1));
  }

  private normalize(): void {
    const s = this.post.reduce((a, b) => a + b, 0) || 1;
    this.post = this.post.map((v) => v / s);
  }

  mean(): number {
    return this.alphas.reduce((acc, a, i) => acc + a * (this.post[i] ?? 0), 0);
  }

  sd(): number {
    const m = this.mean();
    return Math.sqrt(this.alphas.reduce((acc, a, i) => acc + (a - m) ** 2 * (this.post[i] ?? 0), 0));
  }

  /** The next gray level to show, or null when finished. Trial 1 is the easy one at W = 0.5. */
  next(): GrayStimulus | null {
    if (this.finished) return null;
    if (this.trials.length === 0) {
      return STIMULI.reduce((best, s) => (Math.abs(s.weber - 0.5) < Math.abs(best.weber - 0.5) ? s : best));
    }
    let best: GrayStimulus | null = null;
    let bestH = Infinity;
    for (const s of STIMULI) {
      let pc = 0;
      const pcs = this.alphas.map((a) => pCorrect(s.x, a));
      for (let i = 0; i < pcs.length; i++) pc += (this.post[i] ?? 0) * (pcs[i] ?? 0);
      const postC = this.post.map((p, i) => (p * (pcs[i] ?? 0)) / (pc || 1));
      const postI = this.post.map((p, i) => (p * (1 - (pcs[i] ?? 0))) / (1 - pc || 1));
      const h = pc * entropy(postC) + (1 - pc) * entropy(postI);
      if (h < bestH) {
        bestH = h;
        best = s;
      }
    }
    return best;
  }

  record(stim: GrayStimulus, correct: boolean): void {
    if (this.finished) return;
    const first = this.trials.length === 0;
    this.trials.push({ stim, correct });
    this.post = this.post.map((p, i) => {
      const pc = pCorrect(stim.x, this.alphas[i] ?? 0);
      return p * (correct ? pc : 1 - pc);
    });
    this.normalize();
    if (!first) this.questTrials += 1;
    if (correct && stim.weber <= 0.02) this.ceiling += 1;
    if (this.questTrials >= this.maxQuest || this.ceiling >= 3 || (this.questTrials >= 3 && this.sd() < 0.12)) {
      this.finished = true;
    }
  }
}
