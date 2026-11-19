import { Icon } from '@webable/ui';
import type { ReactNode } from 'react';

export interface FaqItem {
  id: string;
  question: string;
  answer: ReactNode;
}

/**
 * Questions and answers as native disclosures: each row opens on its own, the
 * keyboard and find-in-page reach every answer, and nothing needs script.
 */
export function Faq({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="wm-faq">
      {items.map((item) => (
        <details key={item.id} id={item.id} className="wm-faq__item">
          <summary className="wm-faq__question">
            <span>{item.question}</span>
            <Icon name="plus" size={20} className="wm-faq__icon" />
          </summary>
          <div className="wm-faq__answer">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
