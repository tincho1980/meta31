import type { ProjectionLine } from '@meta31/contracts';
import { derivedLabel, enumLabel } from '../glossary';

type Kind = 'pending' | 'partial' | 'postponed' | 'paid' | 'to_collect' | 'collected';

/** Which state glyph a line shows (manual de marca, "Estados de un compromiso"). */
export function glyphKind(line: ProjectionLine, isIncome: boolean): Kind {
  if (isIncome) return line.status === 'received' ? 'collected' : 'to_collect';
  if (line.postponed && line.status !== 'paid') return 'postponed';
  if (line.status === 'paid') return 'paid';
  if (line.status === 'partially_paid') return 'partial';
  return 'pending';
}

/** Accessible text of the glyph: the state written out. */
export function glyphLabel(line: ProjectionLine, isIncome: boolean): string {
  const kind = glyphKind(line, isIncome);
  if (kind === 'postponed') return derivedLabel('postponed');
  if (isIncome) return enumLabel('income_status', line.status === 'received' ? 'received' : 'expected');
  return enumLabel('commitment_status', line.status ?? 'pending');
}

/**
 * 16 px glyph, 2 px stroke: empty ring = pending, half ring = partially paid, dashed ring in
 * terracota = postponed, filled circle = paid, ring with + in verde-ingreso = income to collect.
 * The state is never shown as a colored label: the row's place is for the amount.
 */
export function StatusGlyph({ line, isIncome }: { line: ProjectionLine; isIncome: boolean }) {
  const kind = glyphKind(line, isIncome);
  const label = glyphLabel(line, isIncome);
  const color = kind === 'postponed' ? 'var(--terracota)' : isIncome ? 'var(--verde-ingreso)' : 'var(--verde-casa)';
  return (
    <svg className="glyph" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={label}>
      <title>{label}</title>
      {kind === 'paid' || kind === 'collected' ? (
        <circle cx="8" cy="8" r="7" fill={color} />
      ) : (
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={kind === 'postponed' ? '3 2.2' : undefined}
        />
      )}
      {kind === 'partial' && <path d="M8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill={color} />}
      {kind === 'to_collect' && <path d="M8 4.5v7M4.5 8h7" stroke={color} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
