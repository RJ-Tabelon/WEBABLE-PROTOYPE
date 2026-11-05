// Round 10: the contract between the WebAble page (which groups its blocks and asks for components) and the component
// renderer (which draws a group's ComposeBlocks). The renderer is pure: data in, Preact out, no engine calls except
// through the links it is given.
import type { ComposeBlock } from '@webable/core';
import type { LinkPart } from '../model';

export interface ComposedProps {
  /** The group's components, already checked (draw them in order). */
  blocks: ComposeBlock[];
  /** The page's own links: ⟦n⟧ in any text field is links[n - 1] (draw with the page's InlineLink). */
  links: LinkPart[];
  /** True the first time this group is drawn as components: one soft settle-in (none under reduced motion). */
  settle: boolean;
  /** The group's id, for keys and test hooks (data-wa-compose). */
  id: string;
}
