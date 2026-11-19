import { Anchor, Wordmark } from '@webable/ui';
import { FOOTER_COLUMNS } from './nav';
import { ThemeControl } from './ThemeControl';

/**
 * Site footer (design-final §7.10): a tonal band with the honesty line, link
 * columns (4 at ≥64em, 2 at ≥48em, 1 below), a System · Light · Dark control and
 * the legal row.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="wa-site-footer">
      <div className="wa-site-footer__inner">
        <div className="wa-site-footer__lead">
          <Anchor
            href="/"
            className="wa-site-footer__brand"
            aria-label="WebAble home"
          >
            <Wordmark />
          </Anchor>
          <p className="wa-site-footer__honesty">
            WebAble changes how pages look and work for you. It doesn’t make any
            site accessible or compliant.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav
            key={column.heading}
            className="wa-site-footer__column"
            aria-labelledby={`footer-${column.heading}`}
          >
            <h2
              id={`footer-${column.heading}`}
              className="wa-site-footer__heading"
            >
              {column.heading}
            </h2>
            <ul role="list">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Anchor href={link.href} className="wa-site-footer__link">
                    {link.label}
                  </Anchor>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="wa-site-footer__legal">
        <p>© {year} WebAble</p>
        <div className="wa-site-footer__theme">
          <span id="footer-theme-label" className="wa-site-footer__theme-label">
            Theme
          </span>
          <ThemeControl labelledBy="footer-theme-label" />
        </div>
      </div>
    </footer>
  );
}
