import { t } from '../glossary';

/**
 * Typographic logotype (manual de marca): "Meta" in Fraunces 600 and an italic "31" circled
 * by the hand-drawn stroke. Colors come from the context: `.on-green` for the main version.
 * The stroke is always this same drawing: never redraw it or replace it with a circle.
 */
export function Logo() {
  const name = t('app_name');
  return (
    <span className="logo" aria-label={name} role="img">
      Meta
      <span className="n">
        31
        <svg viewBox="0 0 48 42" fill="none" aria-hidden="true">
          <path d="M31 4C13 2 2 12 4 23C6 35 31 39 41 29C47 21 43 6 23 6" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  );
}
