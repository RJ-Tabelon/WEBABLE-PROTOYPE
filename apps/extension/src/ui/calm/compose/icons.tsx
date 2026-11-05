// Round 10: the thin line icons the WebAble page's components may show (Lucide, drawn as inline SVG: no url(), no
// network, no emoji). Only the COMPOSE_ICONS names exist here; anything else draws nothing. All decorative: aria-hidden.
import { COMPOSE_ICONS, type ComposeIcon } from '@webable/core';
import type { JSX } from 'preact';
import {
  Baby, Banknote, Briefcase, Calculator, Calendar, Car, ChartColumn, CircleCheck, CircleHelp, CircleX, ClipboardList, Clock,
  CreditCard, Download, Eye, FileText, Gift, Globe, GraduationCap, HeartPulse, Hourglass, House, Info, Landmark, Leaf,
  Lightbulb, Link, ListChecks, Lock, Mail, MapPin, MessageCircle, Package, Percent, PiggyBank, Pill, Plane, Phone, Quote,
  Receipt, RefreshCw, Scale, Search, ShieldCheck, Sparkles, Star, Stethoscope, Sun, TrendingDown, TrendingUp, TriangleAlert,
  Trophy, Truck, User, Users, Utensils, WandSparkles, Wallet, Brain,
  type IconNode,
} from 'lucide';

/** Each catalog name to its Lucide drawing ([tag, attrs] pairs). */
export const ICON_NODES: Record<ComposeIcon, IconNode> = {
  clock: Clock, calendar: Calendar, hourglass: Hourglass, banknote: Banknote, 'credit-card': CreditCard, wallet: Wallet,
  'piggy-bank': PiggyBank, receipt: Receipt, percent: Percent, calculator: Calculator, landmark: Landmark,
  'triangle-alert': TriangleAlert, info: Info, 'circle-check': CircleCheck, 'circle-x': CircleX, 'shield-check': ShieldCheck,
  lock: Lock, phone: Phone, mail: Mail, 'map-pin': MapPin, globe: Globe, 'message-circle': MessageCircle,
  'file-text': FileText, 'clipboard-list': ClipboardList, 'list-checks': ListChecks, scale: Scale,
  'graduation-cap': GraduationCap, briefcase: Briefcase, user: User, users: Users, baby: Baby, 'heart-pulse': HeartPulse,
  pill: Pill, stethoscope: Stethoscope, brain: Brain, lightbulb: Lightbulb, sparkles: Sparkles, eye: Eye, search: Search,
  'refresh-cw': RefreshCw, 'trending-up': TrendingUp, 'trending-down': TrendingDown, 'chart-column': ChartColumn,
  trophy: Trophy, star: Star, house: House, car: Car, plane: Plane, utensils: Utensils, leaf: Leaf, sun: Sun, quote: Quote,
  'circle-help': CircleHelp, link: Link, download: Download, package: Package, truck: Truck, gift: Gift,
  'wand-sparkles': WandSparkles,
};

const NAMES: ReadonlySet<string> = new Set(COMPOSE_ICONS);

/** True for a name in the catalog (the model's icon fields are checked again here before drawing). */
export function isComposeIcon(name: unknown): name is ComposeIcon {
  return typeof name === 'string' && NAMES.has(name);
}

/**
 * One line icon at `size` (any CSS length; default 1.2em so it follows the person's text size). Stroke 1.75 in the
 * text colour; the stylesheet colours a few by meaning (check in green, warning in amber).
 */
export function Icon({ name, size, class: cls }: { name: ComposeIcon | null | undefined; size?: string; class?: string }): JSX.Element | null {
  if (!isComposeIcon(name)) return null;
  const node = ICON_NODES[name];
  const dim = size ?? '1.2em';
  return (
    <svg
      class={cls ? `wa-cx-ic ${cls}` : 'wa-cx-ic'}
      data-icon={name}
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {node.map(([tag, attrs], i) => {
        const Tag = tag as unknown as 'path';
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
