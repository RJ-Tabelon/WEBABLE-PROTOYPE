'use client';

import { Icon, SwitchRow, useToast } from '@webable/ui';
import { useState } from 'react';

import { updateAccountAction } from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { nudgeExtension } from '../../../lib/extension/bridge';

type Key = 'cloudAnalysis' | 'productLearning';

export interface ConsentSwitchesProps {
  cloudAnalysis: boolean;
  productLearning: boolean;
}

export const CONSENT_FACTS: Record<
  Key,
  Array<{ term: string; detail: string }>
> = {
  cloudAnalysis: [
    {
      term: 'When',
      detail:
        'Only when WebAble can’t tell what part of a page is for. Only on English pages, and never on password or payment pages.',
    },
    {
      term: 'What is sent',
      detail:
        'Where each part of the page sits and its rough size. Counts of links and buttons. Words from a fixed public list, like “menu” or “sidebar”.',
    },
    {
      term: 'To whom',
      detail:
        'WebAble’s server. It asks the Jev model, run by TypeSafe AI, what each part is for.',
    },
    {
      term: 'Never sent',
      detail:
        'Page text, anything you type, the site’s address, your fit, or your browsing history.',
    },
    {
      term: 'Kept',
      detail:
        'The server keeps a count of requests, to limit how often this runs. It doesn’t keep what was sent.',
    },
  ],
  productLearning: [
    {
      term: 'What is sent',
      detail:
        'For up to 4 kinds of change every 4 weeks: whether it helped. This device flips that answer at random 1 time in 4.',
    },
    {
      term: 'With it',
      detail:
        'The kind of change, the kind of page, and a coarse level (none, some or strong) of how well it fits you.',
    },
    {
      term: 'Your account',
      detail:
        'Your account is used to check you turned this on and to allow one report every 4 weeks. It isn’t stored with the counts.',
    },
    {
      term: 'Never sent',
      detail: 'The site, the page, or your fit.',
    },
    {
      term: 'Kept',
      detail:
        'Only running totals, with no account attached. A total is used once 50 or more devices share it.',
    },
  ],
};

/**
 * The two consents, each with exactly what it sends (design-final §13.1 rule 9).
 * Both are off by default. Switching one saves at once and tells the extension;
 * if saving fails the switch goes back and says why.
 */
export function ConsentSwitches(initial: ConsentSwitchesProps) {
  const [values, setValues] = useState<Record<Key, boolean>>({
    cloudAnalysis: initial.cloudAnalysis,
    productLearning: initial.productLearning,
  });
  const [pending, setPending] = useState<Key | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const toast = useToast();

  async function change(key: Key, next: boolean) {
    if (pending) return;
    const previous = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setPending(key);
    let message: string | null = null;
    try {
      const result = await updateAccountAction({ [key]: next });
      if (!result.ok) message = result.error.message;
      else setValues((v) => ({ ...v, [key]: result.data[key] }));
    } catch {
      message = DATA_ERROR_MESSAGES.unavailable;
    }
    setPending(null);
    if (message) {
      setValues((v) => ({ ...v, [key]: previous }));
      setErrors((e) => ({ ...e, [key]: message ?? undefined }));
      return;
    }
    void nudgeExtension();
    const name =
      key === 'cloudAnalysis' ? 'Page analysis' : 'Help improve WebAble';
    toast.show({
      message: `${name} is ${next ? 'on' : 'off'}.`,
      action: { label: 'Undo', onAction: () => void change(key, !next) },
    });
  }

  const rows: Array<{ key: Key; label: string; description: string }> = [
    {
      key: 'cloudAnalysis',
      label: 'Page analysis',
      description:
        'Lets WebAble ask what unclear parts of a page are for, so it can soften ads and side panels.',
    },
    {
      key: 'productLearning',
      label: 'Help improve WebAble',
      description:
        'Shares scrambled, anonymous counts of which changes help. Off unless you turn it on.',
    },
  ];

  return (
    <div className="wa-consents">
      {rows.map(({ key, label, description }) => (
        <div key={key} className="wa-consent">
          <SwitchRow
            label={label}
            description={description}
            checked={values[key]}
            onCheckedChange={(next) => void change(key, next)}
            aria-busy={pending === key || undefined}
          />
          {errors[key] ? (
            <p className="wa-field__error" role="alert">
              <Icon name="triangle-alert" size={20} />
              <span>{errors[key]}</span>
            </p>
          ) : null}
          <dl className="wa-facts" aria-label={`${label}: details`}>
            {CONSENT_FACTS[key].map((fact) => (
              <div key={fact.term} className="wa-facts__row">
                <dt>{fact.term}</dt>
                <dd>{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
