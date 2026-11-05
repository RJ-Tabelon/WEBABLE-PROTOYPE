# The research behind the onboarding

Why each of the five onboarding games exists, what published measure it borrows from, who it helps us notice, what a
30-second game can and can't tell us, and what it sets in WebAble. Written by Wren (Sid's Claude) for round 8, from
`docs/agents/ROUND8.md` §3 and `docs/agents/WREN-2.md`.

Every citation below was checked against an online record on 2026-10-25 (publisher, PubMed, the authors' pages or a
library record); none is from memory. Where we could only see an abstract, the text says so. Numbers from these papers
are **their** results, never ours. `docs/CLAIMS.md` still rules what WebAble itself can claim.

This document names conditions because it's research for the team and the pitch. **Nothing a user sees ever does.**
The onboarding measures needs: how big text has to be, how faint is too faint, how big a button has to be.

---

## How a short game can stand in for a clinical test

Clinical tests are long because they have to be exact for a diagnosis. We don't diagnose; we choose a setting. That
lets us borrow three things from the research:

- **Adaptive procedures.** A staircase changes difficulty after each answer and homes in on a threshold in a few dozen
  trials. Levitt's transformed up-down methods (1971) showed that a "2-down, 1-up" rule settles where a person is right
  about 71% of the time, with no assumptions about the shape of their curve. Lesmes et al. (2010) estimated a whole
  contrast sensitivity curve in about 50 trials with a Bayesian version, and it agreed with conventional testing. This is
  why every section can stop early once it's sure.
- **The same stimuli, on a screen.** The MNREAD reading test on an iPad gave the same critical print size as the printed
  chart, for people with normal and low vision (Calabrèse et al. 2018). A screen version is sound when the conditions
  match.
- **Ordinary use as evidence.** Pointing measured during weeks of normal computer use matched lab measures once
  deliberate movements were picked out (Gajos, Reinecke & Herrmann 2012). So the onboarding only has to be a good first
  guess; WebAble's passive learning keeps correcting it.

**The limits, honestly:**
- About 30 seconds per section gives a starting point, not a measurement you could put in a medical record.
- We don't know the viewing distance, the screen's real brightness, or its colour accuracy. Results are in screen
  pixels for *this* device as the person sits now.
- One sitting can't see a bad day, glare, or a phone on a bus (Sears et al. 2003 call these situationally induced
  impairments). That's why WebAble keeps learning, and why the results page should say so.
- None of this has been validated as a whole on people yet. The pilot in `docs/CLAIMS.md` is the first step.

---

## 1. Reading size

**Borrows from:** the MNREAD reading test (Legge, Ross, Luebker & LaMay 1989). MNREAD measures reading speed on short
sentences that get smaller in 0.1 log steps. Each sentence is exactly 60 characters, set on three lines, so speeds
compare across sizes. From that comes the **critical print size**: the smallest print that still allows close to the
person's top reading speed (often defined as 90% of it, or the end of the speed plateau). MNREAD is now the standard
reading test in low-vision clinics, and its iPad version agrees with the chart (Calabrèse et al. 2018).

**Who it helps us notice, and what they need from a page:**
- People with **low vision** need text at or above their critical print size; below it, reading slows sharply.
- **Older adults**: near focus weakens with age, so small text gets harder; they need larger body text.
- People with **dyslexia** read faster with larger text. In an eye-tracking study on Wikipedia, 18-point text gave
  shorter fixations than 10- or 26-point for readers with dyslexia (Rello et al. 2013), and a larger
  study of 104 readers found readability rose with font size for everyone (Rello, Pielot & Marcos 2016).
- **Situational:** a small laptop screen at arm's length, or glare.

**The game version, and its limits:** sentences step down in size; the person taps "Done" after each; every third
sentence a one-tap question checks it was really read. The critical print size is where speed falls more than about 20%
below their best. Limits: we don't know the viewing distance, so the result only holds at the distance they sat at;
tapping "Done" adds a little time to each trial; and four or five sizes is fewer than the full chart.

**What it sets:** the text size WebAble uses on every site (body text about 1.4× the critical print size, never under
16 px), and extra reading support (line spacing, shorter lines) when even their top speed is slow.

**Petals:** *Small text*, and with reading speed, *Long reading*.

---

## 2. Faint words

**Borrows from:** the Pelli-Robson contrast sensitivity chart (Pelli, Robson & Wilkins 1988). It shows letters of a fixed
size that get fainter in groups of three; the score is the faintest group the person can still read. Contrast
sensitivity predicts everyday visual function better than acuity alone (the motivation behind Lesmes et al. 2010).

**Who it helps us notice, and what they need from a page:**
- **Older adults**: contrast sensitivity falls at medium and high spatial frequencies from around age 40–50 onward (Owsley
  2011 reviews this). Light grey text on white, which the WebAIM Million finds on most home pages, is exactly what gets
  hard.
- People with **low vision** often need higher contrast as well as larger text.
- **Situational:** sunlight or glare on a screen washes out low-contrast text for everyone.
- Some people read more easily with light text on a dark background; the closing light/dark choice catches that.

**The game version, and its limits:** a word appears, the person picks it from three, and contrast drops on a 2-down
1-up staircase (Levitt 1971). Limits: screens differ in brightness and gamma, so we measure "faint on this screen",
which is what we can fix anyway; and words are easier than single letters, so the threshold will read a little better
than a clinical score.

**What it sets:** how much WebAble darkens faint text, and whether to prefer light or dark pages.

**Petal:** *Faint text*.

---

## 3. Pop the bubbles

**Borrows from:** Fitts's law (Fitts 1954) and the ISO 9241-9 pointing test, now ISO 9241-411. Fitts showed movement time
grows with distance and shrinks with target size; the ISO test measures this with targets at set sizes and distances,
summarised as throughput (Soukoreff & MacKenzie 2004). MacKenzie, Kauppinen & Silfverberg (2001) added measures of
*how* the pointer moves within a trial: target re-entries, movement variability, direction changes. Those catch shaky or
overshooting movement that time alone misses.

**Who it helps us notice, and what they need from a page:**
- People with **tremor or limited dexterity** need bigger targets, more space between them, and clicks that don't
  register twice. Gajos, Wobbrock & Weld (2008) measured people's pointing with one-time tests and generated interfaces to
  fit; participants with motor impairments were 26.4% faster and made 73% fewer errors than with the default interface.
- **Older adults** find clicking and double-clicking harder than younger adults (Smith, Sharit & Czaja 1999).
- Hurst, Hudson, Mankoff & Trewin (2008) found clear differences in pointing behaviour between people with motor
  impairments, people with vision impairments, older adults and younger adults.
- **Situational:** a trackpad on a lap, a phone on a bus, cold hands.

**The game version, and its limits:** about 24 bubbles at three sizes and varied distances. We record misses, near
misses, re-entries, jitter and how long the press is held. Limits: 24 taps is far fewer than the ISO test; trackpad,
mouse and touch differ, so the result is for the device in use; and a person rushing looks like a person struggling.
The passive learning corrects this over the first days (in simulation, see `docs/CLAIMS.md`).

**What it sets:** the minimum button size, extra space around targets, and "steady clicks" (ignoring an accidental
second press, waiting for a held press).

**Petals:** *Small buttons*, *Steady clicking*.

---

## 4. Find it

**Borrows from:** visual search in clutter, and attention capture by motion.
- Rosenholtz, Li & Nakano (2007) built a measure of visual clutter and found that the time to find a symbol on a map rose
  with clutter.
- Abrams & Christ (2003) showed that the *onset* of motion captures attention even when it carries no useful
  information: a thing that just started moving gets looked at first.
- Forster & Lavie (2016) found that how much irrelevant pictures slow people down varies from person to person and
  goes up with self-reported attention difficulties. A 2021 follow-up found such measures noisy as individual scores,
  so we treat ours as a soft signal.

**Who it helps us notice, and what they need from a page:**
- People with **ADHD or attention differences** lose more time to ads, teasers and anything moving. They need the main
  content first and moving things stopped.
- People with **cognitive or learning differences**, and many **older adults**: busy layouts, interruptions mid-task and
  autoplay are among the barriers W3C's cognitive accessibility research lists.
- People with **motion sensitivity**: the W3C guidance on animation notes that motion such as parallax can trigger
  nausea, dizziness and migraines in people with vestibular disorders. They need movement stopped, not just made less
  distracting. The browser's reduced-motion setting tells us this directly.
- **Situational:** a small screen, a quick look between other tasks.

**The game version, and its limits:** "Find the train times" on a clean mini page, then a busy one. Everyone slows down on
clutter and everyone glances at motion, so only the *extra* cost over this person's own clean time means anything. We
recommend three rounds (see "Changes" below). Limits: three finds is very little data; we can't see where someone looks;
and practice makes the later rounds faster, which the order has to account for.

**What it sets:** how strongly WebAble simplifies busy pages, and whether to stop moving things.

**Petals:** *Busy pages*, *Moving things*.

---

## 5. Sort the colours

**Borrows from:** the Farnsworth D-15 (Farnsworth 1947). The person arranges 15 coloured caps in order of hue; people with
colour vision differences make crossings along predictable "confusion axes", and the direction tells the type. Vingrys &
King-Smith (1988) gave a way to score the arrangement as a single angle and size. The D-15 was designed to separate
strong colour vision differences from normal and mild ones, so even the full test passes many mild cases.

**Who it helps us notice, and what they need from a page:**
- About **8% of men and 0.4% of women** of European descent have a red-green colour vision difference, and 4–6.5% of men
  of Chinese and Japanese descent (Birch 2012). They need information that isn't carried by colour alone: red/green
  status dots, coloured links, charts keyed only by colour.
**The game version, and its limits:** 6 to 8 chips in place of 15, dragged or tapped into order. Limits: no shortened
version has been validated. A 2024 modeling study (a preprint, not peer reviewed) suggests the D-15's crossing pattern
survives ordinary screen colour errors, but a screen still isn't the calibrated lighting the test assumes. So the
colour petal should grow only on a clear, consistent pattern of crossings.

**What it sets:** whether WebAble adds labels or patterns where a page uses colour alone to say something.

**Petal:** *Telling colours apart*.

---

## Prior work that inferred needs from ordinary use or games

- **SUPPLE and SUPPLE++** (Gajos's SUPPLE project; Gajos, Wobbrock & Weld 2008, CHI best paper). Interfaces generated from a
  person's measured abilities. A one-time pointing test (clicking lit dots on a ring) drove the generator; people with
  motor impairments were 26.4% faster with 73% fewer errors. It's the closest ancestor of our "Pop the bubbles".
- **Hurst, Hudson, Mankoff & Trewin (IUI 2008).** Pointing features alone told apart people with motor impairments,
  people with vision impairments, older adults and younger adults. It shows ordinary pointing carries the signal.
- **Gajos, Reinecke & Herrmann (CHI 2012).** Filtered pointing from weeks of normal use matched lab measures. It's the
  basis for letting WebAble keep learning after the onboarding.
- **Dytective** (Rello, Ballesteros, Ali, Serra, Alarcón Sánchez & Bigham 2016). A web game whose play predicted
  dyslexia with 83% accuracy on a held-out set. It shows a short game can carry real signal; it's also why we must be
  careful: we set text size and spacing, and we never screen for or name a condition.
- **Ability-based design** (Wobbrock, Kane, Gajos, Harada & Froehlich 2011). Design around what people *can* do, and
  make the system adapt to them, not the reverse. It's the principle behind measuring needs, not conditions, and it
  separates its idea of ability from clinical assessment.

---

## Changes we recommend

Posted in the Slack thread at 01:15; Lucius passed them to Alfred, who built all three in a minute later.

1. **Split "Find it" into three short rounds:** a clean page, a busy page with nothing moving, and the same busy page plus
   one moving banner. Score each against the person's own clean round: busy-still minus clean sets the busy-pages need,
   busy-moving minus busy-still sets the moving-things need. Everyone slows on clutter (Rosenholtz et al. 2007) and
   everyone's attention goes to new motion (Abrams & Christ 2003), so only the person's *extra* cost is informative, and
   timing is a better motion signal than clicking, since we can't see eyes. Keep it soft (Forster & Lavie 2016; noisy as
   an individual score).
2. **Reading size: keep MNREAD's format and set the conditions.** Same-length sentences so speeds compare, and an
   instruction card that says "Sit as you usually do, and wear your usual glasses", because the result is in pixels at
   that distance.
3. **The results page says WebAble keeps learning, and changes are one tap, not a retake.** One sitting can't see
   situational needs (Sears et al. 2003), and in-situ measurement works (Gajos et al. 2012; Hurst et al. 2008).

Also:
- **Keep "Sort the colours" last, and grow its petal only on a consistent crossing pattern.** No short version is
  validated (see §5).
- **Record the input device** (mouse, trackpad, touch, keyboard) with the pointing result; Fitts measures differ by device.
- **Don't add sections.** Everything else we'd want (situational needs, day-to-day change) is better learned while
  browsing than tested up front. Three minutes is already the budget.
- **Don't drop any.** Each section maps to a distinct setting WebAble can act on, and each has a published measure
  behind it.

---

## Why we show needs, never conditions

**Evidence.** A need is what WebAble can act on; a condition isn't. Two people with the same diagnosis can need very
different text sizes, and someone with no diagnosis at all can need large buttons on a bus. Ability-based design makes
this the core principle: measure and design for what a person can do, not the label on it (Wobbrock et al. 2011). Our
games also can't diagnose. They run for seconds on an uncalibrated screen, and the clinical tests they borrow from are
part of a clinician's examination, not a verdict on their own. Naming a condition would claim accuracy we don't have.

**Ethics.** Disability information is among the most sensitive data a person has, and people often don't share it
precisely because of the risk of discrimination (Trewin et al. 2019). A tool that labels people creates that risk even if
the label never leaves the laptop, and many people who'd benefit, especially older adults and people with situational
needs, don't identify as disabled and would walk away from a tool that tells them they are. So WebAble learns the need,
never the cause, keeps what it learns on the laptop, and lets the person change anything.

---

## References

- Abrams, R. A., & Christ, S. E. (2003). Motion onset captures attention. *Psychological Science*, 14(5), 427–432.
  <https://pubmed.ncbi.nlm.nih.gov/12930472/>
- Birch, J. (2012). Worldwide prevalence of red-green color deficiency. *Journal of the Optical Society of America A*,
  29(3), 313–320. (Abstract seen via an index; full text not checked.)
- Calabrèse, A., et al. (2018). Comparing performance on the MNREAD
  iPad application with the MNREAD acuity chart. *Journal of Vision*, 18(1), 8. <https://pubmed.ncbi.nlm.nih.gov/29351351/>
- Farnsworth, D. (1947). *The Farnsworth Dichotomous Test for Color Blindness: Panel D-15. Manual.* New York: The
  Psychological Corporation. (Library record; original not seen.)
- Fitts, P. M. (1954). The information capacity of the human motor system in controlling the amplitude of movement.
  *Journal of Experimental Psychology*, 47(6), 381–391. <https://pubmed.ncbi.nlm.nih.gov/13174710>
- Forster, S., & Lavie, N. (2016). Establishing the attention-distractibility trait. *Psychological Science*, 27(2),
  203–212. <https://discovery.ucl.ac.uk/id/eprint/1489446/>
- Gajos, K. Z., Reinecke, K., & Herrmann, C. (2012). Accurate measurements of pointing performance from in situ
  observations. *CHI '12*, 3157–3166. <https://www.eecs.harvard.edu/~kgajos/papers/2012/gajos12accurate.shtml>
- Gajos, K. Z., Wobbrock, J. O., & Weld, D. S. (2008). Improving the performance of motor-impaired users with
  automatically-generated, ability-based interfaces. *CHI '08*, 1257–1266. <https://doi.org/10.1145/1357054.1357250>
- Gajos, K. SUPPLE: Automatically generating personalized user interfaces (project page).
  <https://www.eecs.harvard.edu/~kgajos/research/supple/>
- Hurst, A., Hudson, S. E., Mankoff, J., & Trewin, S. (2008). Automatically detecting pointing performance. *IUI '08*,
  11–19.
- Legge, G. E., Ross, J. A., Luebker, A., & LaMay, J. M. (1989). Psychophysics of reading. VIII. The Minnesota Low-Vision
  Reading Test. *Optometry and Vision Science*, 66(12), 843–853. MNREAD design: <https://mnread.umn.edu/design>
- Lesmes, L. A., Lu, Z.-L., Baek, J., & Albright, T. D. (2010). Bayesian adaptive estimation of the contrast sensitivity
  function: The quick CSF method. *Journal of Vision*, 10(3), 17. <https://pmc.ncbi.nlm.nih.gov/articles/PMC4439013>
- Levitt, H. (1971). Transformed up-down methods in psychoacoustics. *Journal of the Acoustical Society of America*, 49,
  467–477. <https://doi.org/10.1121/1.1912375>
- MacKenzie, I. S., Kauppinen, T., & Silfverberg, M. (2001). Accuracy measures for evaluating computer pointing devices.
  *CHI '01*, 9–16. <https://doi.org/10.1145/365024.365028>
- Owsley, C. (2011). Aging and vision. *Vision Research*, 51(13), 1610–1622.
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC3049199>
- Pelli, D. G., Robson, J. G., & Wilkins, A. J. (1988). The design of a new letter chart for measuring contrast
  sensitivity. *Clinical Vision Sciences*, 2, 187–199. (Library records; full text not checked.)
- Rello, L., et al. (2013). Size matters (spacing not): 18 points for a dyslexic-friendly Wikipedia. *W4A '13*.
- Rello, L., Pielot, M., & Marcos, M.-C. (2016). Make it big! The effect of font size and line spacing on online
  readability. *CHI '16*, 3637–3648.
- Rello, L., Ballesteros, M., Ali, A., Serra, M., Alarcón Sánchez, D., & Bigham, J. P. (2016). Dytective: Diagnosing risk
  of dyslexia with a game. *PervasiveHealth '16*, 89–96. <https://www.cs.cmu.edu/~jbigham/pubs/pdfs/2016/PerHealth2016-Dytective.pdf>
- Rosenholtz, R., Li, Y., & Nakano, L. (2007). Measuring visual clutter. *Journal of Vision*, 7(2), 17.
  <https://dspace.mit.edu/handle/1721.1/37287>
- Sears, A., Lin, M., Jacko, J., & Xiao, Y. (2003). When computers fade: Pervasive computing and situationally-induced
  impairments and disabilities. *Proc. HCI International*, 1298–1302.
- Smith, M. W., Sharit, J., & Czaja, S. J. (1999). Aging, motor control, and the performance of computer mouse tasks.
  *Human Factors*, 41(3), 389–396.
- Soukoreff, R. W., & MacKenzie, I. S. (2004). Towards a standard for pointing device evaluation: Perspectives on 27 years
  of Fitts' law research in HCI. *International Journal of Human-Computer Studies*, 61, 751–789.
  <https://www.yorku.ca/mack/ijhcs2004.html>
- Trewin, S., et al. (2019). Considerations for AI fairness for people with disabilities. *AI Matters*, 5(3).
  <https://doi.org/10.1145/3362077.3362086>
- Vingrys, A. J., & King-Smith, P. E. (1988). A quantitative scoring technique for panel tests of color vision.
  *Investigative Ophthalmology and Visual Science*, 29, 50–63.
- W3C. Understanding Success Criterion 2.3.3: Animation from Interactions.
  <https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions>
- W3C Cognitive and Learning Disabilities Accessibility Task Force. Cognitive Accessibility User Research.
  <https://www.w3.org/TR/coga-user-research>
- Wobbrock, J. O., Kane, S. K., Gajos, K. Z., Harada, S., & Froehlich, J. (2011). Ability-based design: Concept,
  principles and examples. *ACM Transactions on Accessible Computing*, 3(3), 9.
  <https://doi.org/10.1145/1952383.1952384>
- D15 display-accuracy modeling study (2024, preprint, not peer reviewed). The D15 color arrangement test retains its
  diagnostic value regardless of display accuracy. medRxiv 10.1101/2024.11.15.24314633.
