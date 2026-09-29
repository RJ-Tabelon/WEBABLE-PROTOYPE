'use client';

import {
  Actions,
  Button,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorPanel,
  FitMark,
  FitMarkBlock,
  Icon,
  ICON_NAMES,
  IconButton,
  IndexRule,
  Kbd,
  Mark,
  OfferBlock,
  OverlayContainer,
  ProgressRuler,
  SectionHeader,
  SegmentedControl,
  Select,
  Sheet,
  Slider,
  StatusGlyph,
  StatusLine,
  StatusPill,
  SwitchRow,
  TextField,
  TextLink,
  Toast,
  Tooltip,
  useToast,
  Wordmark,
  type ExtensionStatus,
} from '@webable/ui';
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { ThemeControl } from '../../../components/shell/ThemeControl';
import { ColourTokens } from './ColourTokens';

/* ---------------------------------------------------------------- scaffolding */

const SECTIONS = [
  ['type', 'Type'],
  ['colour', 'Colour'],
  ['space', 'Space and shape'],
  ['motion', 'Motion'],
  ['buttons', 'Buttons'],
  ['icons', 'Icons'],
  ['links', 'Links'],
  ['switches', 'Switches'],
  ['checkboxes', 'Checkboxes'],
  ['segmented', 'Segmented'],
  ['sliders', 'Sliders'],
  ['fields', 'Fields'],
  ['disclosure', 'Disclosure'],
  ['overlays', 'Overlays'],
  ['toast', 'Toast'],
  ['status', 'Status'],
  ['fit', 'Fit mark'],
  ['structure', 'Structure'],
  ['states', 'Empty and error'],
  ['ruler', 'Progress ruler'],
  ['offer', 'Offer'],
  ['brand', 'Brand'],
  ['shells', 'Shells'],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/** `?section=<id>` renders one section on its own (handy for narrow-viewport review). */
const OnlyContext = createContext<string | null>(null);

function Section({
  id,
  eyebrow,
  title,
  deck,
  children,
  paired = true,
}: {
  id: SectionId;
  eyebrow: string;
  title: string;
  deck?: ReactNode;
  children: ReactNode;
  paired?: boolean;
}) {
  const only = useContext(OnlyContext);
  if (only && only !== id) return null;
  return (
    <section id={id} className="g-section" aria-labelledby={`${id}-title`}>
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        deck={deck}
        titleId={`${id}-title`}
      />
      {paired ? <ThemePair>{children}</ThemePair> : children}
    </section>
  );
}

/** Renders the same specimen in a light and a dark panel, side by side. */
function ThemePair({ children }: { children: ReactNode }) {
  return (
    <div className="g-pair">
      <ThemePanel theme="light">{children}</ThemePanel>
      <ThemePanel theme="dark">{children}</ThemePanel>
    </div>
  );
}

function ThemePanel({
  theme,
  children,
}: {
  theme: 'light' | 'dark';
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  return (
    <div ref={setPanel} className="g-panel" data-theme={theme}>
      <p className="g-panel__label">{theme === 'light' ? 'Light' : 'Dark'}</p>
      <OverlayContainer container={panel}>{children}</OverlayContainer>
    </div>
  );
}

function Specimen({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'g-specimen g-specimen--wide' : 'g-specimen'}>
      <p className="g-specimen__label">{label}</p>
      <div className="g-specimen__body">{children}</div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="g-row">{children}</div>;
}

/* ---------------------------------------------------------------- foundations */

const TYPE_ROLES = [
  {
    token: '--text-display',
    size: '40 to 64 px',
    sample: 'The web, made to measure.',
    className: 'wa-display',
  },
  { token: '--text-h1', size: '32 to 44 px', sample: 'Your fit', tag: 'h1' },
  {
    token: '--text-h2',
    size: '26 to 32 px',
    sample: 'Three short tasks. Then every site fits.',
    tag: 'h2',
  },
  {
    token: '--text-h3',
    size: '22 to 24 px',
    sample: 'Delete your data?',
    tag: 'h3',
  },
  {
    token: '--text-title',
    size: '20 px',
    sample: 'Adapted · 3 changes',
    className: 'wa-title',
  },
  {
    token: '--text-lead',
    size: '20 px',
    sample:
      'WebAble learns how you read, point and focus, then adjusts each site to fit.',
    className: 'wa-lead',
  },
  {
    token: '--text-body',
    size: '18 px',
    sample:
      'You see every change and can undo it. Nothing about you is sent, only the shape of the page.',
    className: 'wa-body',
  },
  {
    token: '--text-ui',
    size: '16 px',
    sample: 'Changes apply right away on this site.',
    className: '',
  },
  {
    token: '--text-meta',
    size: '15 px, the floor',
    sample: 'About 6 minutes. Skip any part.',
    className: 'wa-meta',
  },
  {
    token: '--text-mono',
    size: '15 px Mono',
    sample: 'Il1| O0o rn/m paypal.com paypaI.com',
    className: 'wa-mono',
  },
] as const;

function TypeScale() {
  return (
    <div className="g-type">
      {TYPE_ROLES.map((role) => {
        const Tag = 'tag' in role ? role.tag : 'p';
        return (
          <div key={role.token} className="g-type__row">
            <p className="g-type__meta">
              <code>{role.token}</code>
              <span>{role.size}</span>
            </p>
            <Tag className={'className' in role ? role.className : undefined}>
              {role.sample}
            </Tag>
          </div>
        );
      })}
      <div className="g-type__row">
        <p className="g-type__meta">
          <code>--text-readout</code>
          <span>28 px Mono</span>
        </p>
        <FitMark size="readout" from={16} to={19} unit="px" />
      </div>
    </div>
  );
}

const SPACE = [
  ['--space-1', 4],
  ['--space-2', 8],
  ['--space-3', 12],
  ['--space-4', 16],
  ['--space-5', 20],
  ['--space-6', 24],
  ['--space-8', 32],
  ['--space-10', 40],
  ['--space-12', 48],
  ['--space-16', 64],
  ['--space-20', 80],
  ['--space-24', 96],
  ['--space-32', 128],
] as const;

const RADII = [
  ['--radius-0', '0', 'Measurement'],
  ['--radius-1', '4', 'Checkbox, kbd'],
  ['--radius-2', '8', 'Field, row'],
  ['--radius-3', '12', 'Panel, toast'],
  ['--radius-4', '20', 'Modal, sheet'],
  ['--radius-pill', '999', 'Every action'],
] as const;

const ELEVATION = [
  ['--elev-float', 'Popover, toast, select list'],
  ['--elev-modal', 'Modal, sheet'],
  ['--elev-inpage', 'In-page chip on host pages'],
] as const;

const MOTION = [
  ['--dur-1', '100 ms', 'Colour and opacity: hover, press tint'],
  ['--dur-2', '160 ms', 'Switch, segmented indicator, checkbox, chevron'],
  ['--dur-3', '220 / 150 ms', 'Popover, tooltip, toast, popup sub-view'],
  ['--dur-4', '300 / 210 ms', 'Modal and sheet'],
  ['--dur-expand', '220 ms', 'Disclosure height'],
  ['--dur-draw', '600 ms', 'Hero fit-mark draw, once per session'],
  [
    '--ease',
    'cubic-bezier(0.22, 0.8, 0.26, 1)',
    'The one curve: decisive start, soft settle',
  ],
  ['--shift-2', '8 px', 'Maximum travel for anything'],
] as const;

/* ---------------------------------------------------------------- demos */

function PrimaryStates() {
  const reasonId = useId();
  return (
    <>
      <Row>
        <Button variant="primary" data-hovered>
          Save
        </Button>
        <Button variant="primary" data-pressed>
          Save
        </Button>
        <Button variant="primary" data-focus-visible>
          Save
        </Button>
        <Button variant="primary" busy busyLabel="Saving…">
          Save
        </Button>
        <Button variant="primary" disabled aria-describedby={reasonId}>
          Save
        </Button>
      </Row>
      <p id={reasonId} className="wa-reason">
        Save is off until you finish the reading part.
      </p>
    </>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Actions>
      <Button
        variant="secondary"
        size="md"
        onClick={() =>
          toast.show({
            applied: true,
            message: 'Text size is now 18 px on this site.',
            action: { label: 'Undo', onAction: () => undefined },
          })
        }
      >
        Show a toast with Undo
      </Button>
      <Button
        variant="ghost"
        size="md"
        onClick={() =>
          toast.show({ message: 'Your fit is saved on this device.' })
        }
      >
        Show a 6 s toast
      </Button>
    </Actions>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <Actions>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete my data
        </Button>
        <Button
          variant="secondary"
          iconStart="pause"
          onClick={() => setSheet(true)}
        >
          Pause
        </Button>
      </Actions>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your data?"
        description="This removes your fit, its history and your account settings. Sites you visit stay as they are. This can’t be undone."
        actions={
          <>
            <Button variant="danger-filled" onClick={() => setOpen(false)}>
              Delete my data
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep my data
            </Button>
          </>
        }
      />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Paused"
        description="Your answers so far are saved."
        actions={
          <>
            <Button
              variant="primary"
              size="task"
              onClick={() => setSheet(false)}
            >
              Resume
            </Button>
            <Button
              variant="secondary"
              size="task"
              onClick={() => setSheet(false)}
            >
              Save and finish later
            </Button>
          </>
        }
      />
    </>
  );
}

const STATES: ReadonlyArray<{
  state: ExtensionStatus;
  title: string;
  pill?: string;
}> = [
  { state: 'on', title: 'Basic fit is on' },
  { state: 'checking', title: 'Checking this page…' },
  { state: 'adapted', title: 'Adapted · 3 changes', pill: 'Adapted · 3' },
  { state: 'paused', title: 'Paused on this site' },
  { state: 'attention', title: 'Sign in again to sync', pill: 'Needs a look' },
  { state: 'cant-run', title: 'WebAble can’t change this page' },
];

const RULER = [
  { id: 'reading', label: 'Reading', tasks: 6 },
  { id: 'pointing', label: 'Pointing', tasks: 10 },
  { id: 'focus', label: 'Focus', tasks: 4 },
];

/* ---------------------------------------------------------------- page */

export function Gallery({ only = null }: { only?: string | null }) {
  return (
    <OnlyContext.Provider value={only}>
      <div className="g-page">
        <header className="g-head">
          <div className="g-head__inner">
            <Wordmark />
            <div className="g-head__intro">
              <p className="g-head__eyebrow">
                Made to Measure · tokens v1.0 · for design review
              </p>
              <h1 className="g-head__title">Components</h1>
              <p className="g-head__deck">
                Every component in every state, in the light and dark themes
                side by side. States that need a pointer are pinned with{' '}
                <code>data-hovered</code>, <code>data-pressed</code> and{' '}
                <code>data-focus-visible</code>.
              </p>
            </div>
            <div className="g-head__theme">
              <span id="g-theme-label" className="g-head__theme-label">
                Page theme
              </span>
              <ThemeControl labelledBy="g-theme-label" />
            </div>
          </div>
          <nav className="g-toc" aria-label="Sections">
            <ul role="list">
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main id="main" tabIndex={-1} className="g-main">
          {/* ------------------------------------------------ Type */}
          <Section
            id="type"
            eyebrow="Atkinson Hyperlegible Next and Mono · floor 15 px"
            title="Type"
            deck="One family, two weights. Headings step up at 64em. Nothing below 15 px."
          >
            <TypeScale />
          </Section>

          {/* ------------------------------------------------ Colour */}
          <Section
            id="colour"
            eyebrow="Computed live from tokens.css · WCAG 2.x ratios"
            title="Colour"
            deck="Warm stone neutrals and one fern accent that means only “WebAble changed this, or offers to”."
          >
            <ColourTokens />
          </Section>

          {/* ------------------------------------------------ Space */}
          <Section
            id="space"
            eyebrow="4 px base, in rem"
            title="Space and shape"
            deck="Shape encodes role: a pill acts, 8 is a field, 12 a panel, 20 a modal, 0 a measurement."
          >
            <Specimen label="Spacing" wide>
              <div className="g-space">
                {SPACE.map(([token, px]) => (
                  <div key={token} className="g-space__row">
                    <code>{token}</code>
                    <span
                      className="g-space__bar"
                      style={{ inlineSize: `var(${token})` }}
                    />
                    <span className="g-num">{px}</span>
                  </div>
                ))}
              </div>
            </Specimen>
            <Specimen label="Radii" wide>
              <div className="g-radii">
                {RADII.map(([token, px, use]) => (
                  <div key={token} className="g-radii__item">
                    <span
                      className="g-radii__shape"
                      style={{ borderRadius: `var(${token})` }}
                    />
                    <code>{token}</code>
                    <span className="g-caption">
                      {px} · {use}
                    </span>
                  </div>
                ))}
              </div>
            </Specimen>
            <Specimen label="Elevation: floating layers only" wide>
              <div className="g-elev">
                {ELEVATION.map(([token, use]) => (
                  <div
                    key={token}
                    className="g-elev__card"
                    style={{ boxShadow: `var(${token})` }}
                  >
                    <code>{token}</code>
                    <span className="g-caption">{use}</span>
                  </div>
                ))}
              </div>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Motion */}
          <Section
            id="motion"
            eyebrow="One curve, four durations, 8 px of travel at most"
            title="Motion"
            paired={false}
          >
            <dl className="g-motion">
              {MOTION.map(([token, value, use]) => (
                <div key={token} className="g-motion__row">
                  <dt>
                    <code>{token}</code>
                  </dt>
                  <dd className="g-motion__value">{value}</dd>
                  <dd className="g-motion__use">{use}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* ------------------------------------------------ Buttons */}
          <Section
            id="buttons"
            eyebrow="Pill = act · one ink button per region"
            title="Buttons"
          >
            <Specimen label="Variants">
              <Row>
                <Button variant="primary">Use this fit</Button>
                <Button variant="secondary">Adjust first</Button>
                <Button variant="ghost">Show on page</Button>
              </Row>
              <Row>
                <Button variant="danger">Turn WebAble off</Button>
                <Button variant="danger-filled">Delete my data</Button>
              </Row>
            </Specimen>
            <Specimen label="Sizes: sm 36 · md 44 · lg 48 · task 64">
              <Row>
                <Button variant="secondary" size="sm">
                  Undo
                </Button>
                <Button variant="secondary" size="md">
                  Undo
                </Button>
                <Button variant="secondary" size="lg">
                  Undo
                </Button>
                <Button variant="secondary" size="task">
                  Undo
                </Button>
              </Row>
            </Specimen>
            <Specimen label="Primary: hover · pressed · focus · busy · disabled">
              <PrimaryStates />
            </Specimen>
            <Specimen label="Secondary and ghost: hover · pressed · focus · disabled">
              <Row>
                <Button variant="secondary" data-hovered>
                  Not now
                </Button>
                <Button variant="secondary" data-pressed>
                  Not now
                </Button>
                <Button variant="secondary" data-focus-visible>
                  Not now
                </Button>
                <Button variant="secondary" disabled>
                  Not now
                </Button>
              </Row>
              <Row>
                <Button variant="ghost" data-hovered>
                  Show on page
                </Button>
                <Button variant="ghost" data-pressed>
                  Show on page
                </Button>
                <Button variant="ghost" data-focus-visible>
                  Show on page
                </Button>
                <Button variant="ghost" disabled>
                  Show on page
                </Button>
              </Row>
            </Specimen>
            <Specimen label="Danger: hover · focus · disabled">
              <Row>
                <Button variant="danger" data-hovered>
                  Turn off
                </Button>
                <Button variant="danger" data-focus-visible>
                  Turn off
                </Button>
                <Button variant="danger" disabled>
                  Turn off
                </Button>
                <Button variant="danger-filled" data-hovered>
                  Delete
                </Button>
              </Row>
            </Specimen>
            <Specimen label="Icons and arrows: goes somewhere · opens elsewhere">
              <Row>
                <Button variant="primary" href="/tune" arrow="forward">
                  Get started
                </Button>
                <Button
                  variant="ghost"
                  href="https://www.w3.org/WAI/"
                  arrow="external"
                >
                  Your fit
                </Button>
                <Button variant="secondary" iconStart="rotate-ccw" size="md">
                  Undo all
                </Button>
                <Button variant="ghost" iconStart="square-dashed" size="md">
                  Show on page
                </Button>
              </Row>
            </Specimen>
            <Specimen label="A pair: primary first, 12 apart; full width below 30em">
              <Actions>
                <Button variant="primary" size="task">
                  Use this fit
                </Button>
                <Button variant="secondary" size="task">
                  Adjust first
                </Button>
              </Actions>
            </Specimen>
            <Specimen
              label="Equal pair: declining costs the same; wraps below 340 px"
              wide
            >
              <div className="g-popup-width">
                <Actions sizing="equal">
                  <Button variant="primary">Try it</Button>
                  <Button variant="secondary">Not now</Button>
                </Actions>
              </div>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Icons */}
          <Section
            id="icons"
            eyebrow="26 allowlisted Lucide icons · 1.75 px stroke"
            title="Icons and icon buttons"
          >
            <Specimen label="Allowlist at 20 px" wide>
              <ul role="list" className="g-icons">
                {ICON_NAMES.map((name) => (
                  <li key={name}>
                    <Icon name={name} size={20} />
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            </Specimen>
            <Specimen label="Sizes: 16 · 20 · 24 (2 px)">
              <Row>
                <Icon name="settings" size={16} />
                <Icon name="settings" size={20} />
                <Icon name="settings" size={24} />
              </Row>
            </Specimen>
            <Specimen label="Icon buttons: ghost · hover · pressed · focus · disabled · secondary · with tooltip">
              <Row>
                <IconButton icon="settings" label="Settings" tooltip={false} />
                <IconButton
                  icon="settings"
                  label="Settings"
                  tooltip={false}
                  data-hovered
                />
                <IconButton
                  icon="settings"
                  label="Settings"
                  tooltip={false}
                  data-pressed
                />
                <IconButton
                  icon="settings"
                  label="Settings"
                  tooltip={false}
                  data-focus-visible
                />
                <IconButton
                  icon="settings"
                  label="Settings"
                  tooltip={false}
                  disabled
                />
                <IconButton
                  icon="plus"
                  label="Increase text size"
                  variant="secondary"
                  tooltip={false}
                />
                <IconButton icon="x" label="Close" />
              </Row>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Links */}
          <Section
            id="links"
            eyebrow="Ink, underlined; never accent"
            title="Links"
          >
            <Specimen label="Inline · hover · pressed · focus · external · standalone">
              <p className="wa-body wa-secondary">
                WebAble sends page structure only. Read{' '}
                <TextLink href="/privacy#what-webable-sends">
                  what WebAble sends
                </TextLink>
                , or see{' '}
                <TextLink href="/privacy" data-hovered>
                  hover
                </TextLink>
                ,{' '}
                <TextLink href="/privacy" data-pressed>
                  pressed
                </TextLink>{' '}
                and{' '}
                <TextLink href="/privacy" data-focus-visible>
                  focus
                </TextLink>
                . The{' '}
                <TextLink href="https://www.w3.org/WAI/standards-guidelines/wcag/">
                  WCAG overview
                </TextLink>{' '}
                opens in a new tab.
              </p>
              <p>
                <TextLink href="/research" kind="standalone">
                  See the research
                </TextLink>
              </p>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Switches */}
          <Section
            id="switches"
            eyebrow="The whole row is the switch · at least 56 px"
            title="Switch rows"
            deck="Accent track only when the switch changes a page. Settings switches use ink."
          >
            <Specimen label="Changes a page: off · on" wide>
              <SwitchRow label="WebAble on this site" changesPage />
              <SwitchRow
                label="Bigger click targets"
                description="At least 44 px"
                changesPage
                defaultChecked
              />
            </Specimen>
            <Specimen
              label="Setting (ink track): on · hover · pressed · focus"
              wide
            >
              <SwitchRow label="Reduce motion in WebAble" defaultChecked />
              <SwitchRow label="Hover" data-hovered />
              <SwitchRow label="Pressed" data-pressed />
              <SwitchRow
                label="Keyboard focus"
                data-focus-visible
                defaultChecked
                changesPage
              />
            </Specimen>
            <Specimen label="Disabled: off · on, with the reason" wide>
              <SwitchRow
                label="Calmer page"
                disabled
                disabledReason="Turn WebAble on for this site first."
              />
              <SwitchRow
                label="Larger text"
                disabled
                defaultChecked
                changesPage
              />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Checkboxes */}
          <Section
            id="checkboxes"
            eyebrow="20 px box · label is the hit area"
            title="Checkboxes"
          >
            <Specimen label="Unchecked · checked · mixed · disabled">
              <Checkbox>Send anonymous counts to improve WebAble</Checkbox>
              <Checkbox defaultChecked>
                Let WebAble read page structure
              </Checkbox>
              <Checkbox indeterminate>All sites</Checkbox>
              <Checkbox disabled>Sync across devices (sign in first)</Checkbox>
              <Checkbox disabled defaultChecked>
                Required for the extension
              </Checkbox>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Segmented */}
          <Section
            id="segmented"
            eyebrow="Radio group · arrow keys move the selection"
            title="Segmented control"
          >
            <Specimen label="Two and three options">
              <SegmentedControl
                label="Preview"
                options={[
                  { value: 'original', label: 'Original' },
                  { value: 'fitted', label: 'Fitted' },
                ]}
                defaultValue="fitted"
              />
              <SegmentedControl
                label="Theme"
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                defaultValue="system"
              />
            </Specimen>
            <Specimen label="With a disabled option · full width">
              <SegmentedControl
                label="View"
                options={[
                  { value: 'original', label: 'Original' },
                  { value: 'fitted', label: 'Fitted' },
                  { value: 'compare', label: 'Compare', disabled: true },
                ]}
                defaultValue="original"
              />
              <SegmentedControl
                label="Keep"
                fill
                options={[
                  { value: 'new', label: 'Keep new' },
                  { value: 'old', label: 'Keep old' },
                ]}
                defaultValue="new"
              />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Sliders */}
          <Section
            id="sliders"
            eyebrow="Ladders, not ranges · steppers are mandatory"
            title="Sliders"
          >
            <Specimen label="Changes a page (accent): text size" wide>
              <Slider
                label="Text size"
                steps={[14, 16, 18, 21, 24, 28, 32]}
                defaultValue={18}
                format={(v) => `${v} px`}
                formatSpoken={(v) => `${v} pixels`}
                changesPage
              />
            </Specimen>
            <Specimen label="Ink fill: line spacing" wide>
              <Slider
                label="Line spacing"
                steps={[1.5, 1.6, 1.8, 2]}
                defaultValue={1.6}
                format={(v) => v.toFixed(1)}
              />
            </Specimen>
            <Specimen label="Disabled" wide>
              <Slider
                label="Target size"
                steps={[44, 56, 72, 96]}
                defaultValue={56}
                format={(v) => `${v} px`}
                disabled
              />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Fields */}
          <Section
            id="fields"
            eyebrow="48 px · radius 8 · label above"
            title="Fields"
          >
            <Specimen label="Default with hint · required" wide>
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                hint="We’ll send a sign-in link. No password."
                required
              />
            </Specimen>
            <Specimen label="Hover · focus" wide>
              <TextField
                label="Name"
                autoComplete="name"
                defaultValue="Alex"
                data-hovered
              />
              <TextField
                label="Name"
                autoComplete="name"
                defaultValue="Alex"
                data-focus-visible
              />
            </Specimen>
            <Specimen label="Error: says what to do; the value is kept" wide>
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                defaultValue="alex.example.com"
                error="Add the @ and the domain, like name@example.com"
              />
            </Specimen>
            <Specimen label="Disabled · read-only" wide>
              <TextField
                label="Install ID"
                defaultValue="2f6c…91ab"
                disabled
                autoComplete="off"
              />
              <TextField
                label="Account email"
                defaultValue="alex@example.com"
                readOnly
                autoComplete="email"
              />
            </Specimen>
            <Specimen label="Select (always native)" wide>
              <Select
                label="Start page"
                defaultValue="fit"
                options={[
                  { value: 'fit', label: 'Your fit' },
                  { value: 'changes', label: 'Changes' },
                  { value: 'sites', label: 'Sites' },
                ]}
              />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Disclosure */}
          <Section
            id="disclosure"
            eyebrow='hidden="until-found" · find-in-page opens it'
            title="Disclosure"
          >
            <Specimen label="Reading density: closed · open" wide>
              <div>
                <Disclosure title="What does WebAble send?">
                  <p>
                    Page structure only. Never page text, what you type, or your
                    browsing history.
                  </p>
                </Disclosure>
                <Disclosure title="Can I undo a change?" defaultOpen>
                  <p>
                    Yes. Every change has Undo beside it, and Undo all is one
                    step away.
                  </p>
                </Disclosure>
              </div>
            </Specimen>
            <Specimen label="Compact (popup) with a count" wide>
              <Disclosure
                title="What changed"
                meta="3"
                density="compact"
                headingLevel={null}
              >
                <FitMark label="Text size" from={13} to={18} unit="px" />
              </Disclosure>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Overlays */}
          <Section
            id="overlays"
            eyebrow="Native dialog · focus to the title · Esc closes"
            title="Tooltip, modal and sheet"
            deck="Modals only for irreversible or global actions; offers are never modal. Below 48em a modal presents as a bottom sheet."
          >
            <Specimen label="Tooltip: hover 500 ms, focus immediately, Esc dismisses">
              <Row>
                <IconButton icon="settings" label="Settings" />
                <Tooltip content="Highlights this change on the page.">
                  <button
                    type="button"
                    className="wa-btn wa-btn--ghost wa-btn--md"
                  >
                    Show on page
                  </button>
                </Tooltip>
              </Row>
            </Specimen>
            <Specimen label="Modal (danger confirm) · sheet (Pause)">
              <DialogDemo />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Toast */}
          <Section
            id="toast"
            eyebrow="role=status · never takes focus"
            title="Toast"
            deck="A toast with an action stays until dismissed or the page changes. Without one it stays 6 s and pauses on hover or focus."
          >
            <Specimen label="Applied, with Undo" wide>
              <Toast
                applied
                message="Text size is now 18 px on this site."
                action={{ label: 'Undo', onAction: () => undefined }}
                onDismiss={() => undefined}
              />
            </Specimen>
            <Specimen label="Plain message" wide>
              <Toast
                message="Your fit is saved on this device."
                onDismiss={() => undefined}
              />
            </Specimen>
            <Specimen label="Live, in the page's toast region" wide>
              <ToastDemo />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Status */}
          <Section
            id="status"
            eyebrow="Shape first, then word, then colour"
            title="Status"
            deck="The checking arc turns for 5 s, then stops as a half ring and says “Still checking”."
          >
            <Specimen label="Glyphs, 16 and 20">
              <Row>
                {STATES.map(({ state }) => (
                  <span key={state} className="g-glyph">
                    <StatusGlyph state={state} size={16} />
                    <StatusGlyph state={state} size={20} />
                  </span>
                ))}
              </Row>
            </Specimen>
            <Specimen label="Popup state line (20 / medium)" wide>
              <div className="g-stack">
                {STATES.map(({ state, title }) => (
                  <StatusLine key={state} state={state} title={title} />
                ))}
              </div>
            </Specimen>
            <Specimen label="Pills (app Sites list)" wide>
              <Row>
                {STATES.map(({ state, pill }) => (
                  <StatusPill key={state} state={state} label={pill} />
                ))}
              </Row>
            </Specimen>
            <Specimen
              label="Undone by the checks: a neutral row, not an alarm"
              wide
            >
              <div className="g-undone">
                <Icon name="rotate-ccw" size={16} />
                <div>
                  <p className="g-undone__title">Line spacing was undone</p>
                  <p className="wa-meta wa-secondary">
                    It made text overlap here, so WebAble put it back.
                  </p>
                </div>
              </div>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Fit */}
          <Section
            id="fit"
            eyebrow="The signature: a dimension line with real values"
            title="Fit mark"
          >
            <Specimen label="Inline (popup rows)" wide>
              <div className="g-fit-rows">
                <div className="g-fit-row">
                  <FitMark label="Text size" from={13} to={18} unit="px" />
                  <Button variant="ghost" size="md">
                    Undo
                  </Button>
                </div>
                <div className="g-fit-row">
                  <FitMark label="Click targets" from={24} to={44} unit="px" />
                  <Button variant="ghost" size="md">
                    Undo
                  </Button>
                </div>
                <div className="g-fit-row">
                  <FitMark label="Moving things" to="2 paused" />
                  <Button variant="ghost" size="md">
                    Undo
                  </Button>
                </div>
              </div>
            </Specimen>
            <Specimen label="Readout (Your fit)">
              <FitMark size="readout" from={16} to={19} unit="px" />
            </Specimen>
            <Specimen label="Block: on a capture, with a plate" wide>
              <div className="g-capture">
                <div className="g-capture__lines" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <FitMarkBlock
                  label="Text size"
                  from={13}
                  to={18}
                  unit="px"
                  plate
                />
              </div>
            </Specimen>
            <Specimen label="Block: drawn once (hero only)" wide>
              <FitMarkBlock
                label="Click targets"
                from={24}
                to={44}
                unit="px"
                draw
              />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Structure */}
          <Section
            id="structure"
            eyebrow="Index rule · eyebrow states a fact"
            title="Section header and kbd"
          >
            <Specimen label="Section header" wide>
              <SectionHeader
                eyebrow="3 short tasks · about 6 min"
                title="Three short tasks. Then every site fits."
                deck="WebAble measures how you read, point and focus. It never asks for a diagnosis."
                link={{ href: '/research', label: 'See the research' }}
              />
            </Specimen>
            <Specimen label="Index rule on its own" wide>
              <IndexRule />
            </Specimen>
            <Specimen label="Keyboard hint inside a task button">
              <Row>
                <button
                  type="button"
                  className="wa-btn wa-btn--secondary wa-btn--task"
                >
                  True <Kbd>T</Kbd>
                </button>
                <button
                  type="button"
                  className="wa-btn wa-btn--secondary wa-btn--task"
                >
                  Can’t read it <Kbd>C</Kbd>
                </button>
              </Row>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Empty and error */}
          <Section
            id="states"
            eyebrow="Never blame · what happened, what is safe, what to do"
            title="Empty and error"
          >
            <Specimen label="Empty" wide>
              <EmptyState
                title="No sites yet."
                action={<Button variant="secondary">Open a sample page</Button>}
              >
                Sites where you change settings show up here.
              </EmptyState>
            </Specimen>
            <Specimen label="Error, with details" wide>
              <ErrorPanel
                title="Your fit didn’t save."
                action={
                  <Button variant="secondary" size="md" iconStart="refresh-cw">
                    Try again
                  </Button>
                }
                details={<p className="wa-mono">save_fit_profile · 503</p>}
              >
                <p>
                  WebAble couldn’t reach its server. Your fit still works on
                  this device. Try again in a minute.
                </p>
              </ErrorPanel>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Ruler */}
          <Section
            id="ruler"
            eyebrow="Never accent · the dot jumps, never slides"
            title="Progress ruler"
          >
            <Specimen label="Start of Reading" wide>
              <ProgressRuler sections={RULER} current={0} taskIndex={0} />
            </Specimen>
            <Specimen label="Part 2 of 3 · Pointing, task 4 of 10" wide>
              <ProgressRuler sections={RULER} current={1} taskIndex={4} />
            </Specimen>
            <Specimen label="Done" wide>
              <ProgressRuler sections={RULER} current={3} taskIndex={0} />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Offer */}
          <Section
            id="offer"
            eyebrow="A question with two equal answers"
            title="Offer block"
            deck="The only contained surface in the popup. Declining costs the same as accepting."
          >
            <Specimen label="Popup width (348)" wide>
              <div className="g-popup-width">
                <OfferBlock
                  question="Buttons on this page are small. Make them bigger here?"
                  reason="You tapped next to 3 buttons in the last minute."
                  onAccept={() => undefined}
                  onDecline={() => undefined}
                  onNeverHere={() => undefined}
                />
              </div>
            </Specimen>
            <Specimen label="Narrow (stacks below 340 px)" wide>
              <div className="g-narrow">
                <OfferBlock
                  question="Make text larger on this site?"
                  reason="You zoomed in 3 times here."
                  onAccept={() => undefined}
                  onDecline={() => undefined}
                />
              </div>
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Brand */}
          <Section
            id="brand"
            eyebrow="Interim mark · a page, measured"
            title="Brand"
          >
            <Specimen label="Mark at 16 · 20 · 24 · 48">
              <Row>
                <Mark size={16} />
                <Mark size={20} />
                <Mark size={24} />
                <Mark size={48} />
              </Row>
            </Specimen>
            <Specimen label="Wordmark">
              <Wordmark />
              <Wordmark markSize={20} />
            </Specimen>
          </Section>

          {/* ------------------------------------------------ Shells */}
          <Section
            id="shells"
            eyebrow="Reading · Working · Task densities"
            title="Shells"
            paired={false}
          >
            <ul role="list" className="g-shells">
              <li>
                <TextLink href="/dev/shell/site" kind="standalone">
                  Site: header, sheet menu, footer
                </TextLink>
              </li>
              <li>
                <TextLink href="/dev/shell/app" kind="standalone">
                  App: rail, top bar, a document page
                </TextLink>
              </li>
              <li>
                <TextLink href="/dev/shell/task" kind="standalone">
                  Tune: task bar, ruler, action bar
                </TextLink>
              </li>
            </ul>
          </Section>
        </main>
      </div>
    </OnlyContext.Provider>
  );
}
