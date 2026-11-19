import type {
  CardStyle,
  FieldRole,
  FieldShow,
  Importance,
  ItemKind,
  LeadMode,
  MediaShape,
  PageType,
  PrimaryTask,
  SectionKind,
  SectionLayout,
} from './constants';
import type { Locator } from '../skeleton/types';

/**
 * PageSpec: what a page is (docs/10 §4.1). Person-independent: the same page
 * template gets the same spec for everyone, and the fit is applied afterwards,
 * on device, by FitLayout. Zod-free so the content script can import the type.
 */
export interface SpecSection {
  kind: SectionKind;
  importance: Importance;
  /** Node ids covered by the section (highest covering ids, no ancestor/descendant pairs). */
  node_ids: string[];
  /** A heading node inside the section whose text titles it, or null (WebAble's template title). */
  heading_ref: string | null;
  layout: SectionLayout;
}

export interface SpecField {
  /** A slot id inside the collection's exemplar subtree. */
  slot_id: string;
  role: FieldRole;
  show: FieldShow;
}

export interface SpecCollection {
  /** The collection node's id. */
  list_id: string;
  item_kind: ItemKind;
  /** The slot that opens an item (usually the title link), or null. */
  open_slot: string | null;
  /** The card template every record of this collection uses (docs/12 §6.2). */
  card: CardStyle;
  /** The shape the records' media is drawn at. */
  media: MediaShape;
  /** Whether the first record leads (drawn larger). */
  lead: LeadMode;
  fields: SpecField[];
}

export interface PageSpec {
  v: 1;
  page_type: PageType;
  primary_task: PrimaryTask;
  sections: SpecSection[];
  collections: SpecCollection[];
}

/** Why the validator changed a spec (kept for the eval report and defect logs). */
export type SpecRepair =
  | { kind: 'unknown_id'; id: string }
  | { kind: 'duplicate_id'; id: string }
  | { kind: 'overlap'; id: string; kept: string }
  | { kind: 'primary_fixed'; from: number; to: number }
  | { kind: 'protected_unfolded'; section: number }
  | { kind: 'focus_unfolded'; section: number }
  | { kind: 'untrusted_slot'; section: number; id: string }
  | { kind: 'irreversible_demoted'; id: string }
  | { kind: 'collection_dropped'; list_id: string }
  | { kind: 'field_dropped'; list_id: string; slot_id: string }
  | { kind: 'heading_dropped'; section: number; id: string }
  | { kind: 'rest_added'; ids: number }
  /** A second hero got its kind's default layout (one hero per page). */
  | { kind: 'hero_demoted'; section: number }
  /** buy_box outside a product_detail section became reading. */
  | { kind: 'buy_box_demoted'; section: number }
  /** A record collection's chip card became its item kind's default card. */
  | { kind: 'card_demoted'; list_id: string }
  /** `lead: first` where it is not allowed became none. */
  | { kind: 'lead_dropped'; list_id: string };

/**
 * A validated spec ready to render. `rest` lists the ids the spec left out,
 * which Fit view shows under "Everything else on this page" (conservation).
 */
export interface ValidatedSpec {
  spec: PageSpec;
  /** Index into spec.sections of the single primary section. */
  primary: number;
  rest: string[];
  repairs: SpecRepair[];
}

export type SpecSource = 'heuristic' | 'planner';

/** A spec with its provenance, as the worker hands it to the content script. */
export interface SpecEnvelope {
  source: SpecSource;
  /** The extraction the ids belong to (Skeleton.extractionId). */
  extractionId: string;
  validated: ValidatedSpec;
  /** Planner model id, when source is 'planner'. */
  model?: string;
  /** HMAC template key (cache), when known. */
  templateKey?: string;
  createdAt: number;
}

/** A spec stored across page views: ids replaced by locators (`skeleton/locate.ts`). */
export interface StoredSpec {
  schema: string;
  model: string;
  createdAt: number;
  page_type: PageType;
  primary_task: PrimaryTask;
  sections: Array<
    Omit<SpecSection, 'node_ids' | 'heading_ref'> & {
      nodes: Locator[];
      heading: Locator | null;
    }
  >;
  collections: Array<
    Omit<SpecCollection, 'list_id' | 'open_slot' | 'fields'> & {
      list: Locator;
      open: Locator | null;
      fields: Array<{ slot: Locator; role: FieldRole; show: FieldShow }>;
    }
  >;
}
