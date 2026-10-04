// Pieces shared by the screens of rules with periodicity, validity and an amount history:
// income sources and recurring expenses (D7, rule 7, rule 11).
import { type AmountEntry, type Category, EVERY_MONTHS, type Person, type Property } from '@meta31/contracts';
import { useQuery } from '@tanstack/react-query';
import { currentPeriodIso, formatMonth, monthInputToPeriod, monthName, periodToMonthInput } from '../format';
import { columnLabel, t } from '../glossary';
import { api } from '../api';
import { Field } from './Field';

export const CURRENCIES = ['ARS', 'USD', 'UYU'] as const;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Lists the forms need: categories of one kind, people and properties. */
export function useChoices(kind: 'income' | 'expense') {
  const categories = useQuery({
    queryKey: ['categories', kind],
    queryFn: () => api<Category[]>('GET', `/api/categories?kind=${kind}`),
  });
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('GET', '/api/people') });
  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api<Property[]>('GET', '/api/properties') });
  return { categories: categories.data ?? [], people: people.data ?? [], properties: properties.data ?? [] };
}
export type Choices = ReturnType<typeof useChoices>;

/** Amount in force this month: the last one that already started, or the first one if none did. */
export function currentAmount(amounts: AmountEntry[]): AmountEntry | undefined {
  const now = currentPeriodIso();
  return amounts.filter((a) => a.fromPeriod <= now).at(-1) ?? amounts[0];
}

/** Periodicity and validity as the form holds them (texts; months as 'YYYY-MM'). */
export type ScheduleForm = {
  everyMonths: string;
  anchorMonth: string;
  day: string;
  validFrom: string;
  validTo: string;
};

export const emptySchedule = (): ScheduleForm => {
  const month = periodToMonthInput(currentPeriodIso());
  return { everyMonths: '1', anchorMonth: String(Number(month.slice(5, 7))), day: '', validFrom: month, validTo: '' };
};

type ScheduleRule = { everyMonths: number; anchorMonth: number; validFrom: string; validTo: string | null };

export const scheduleOf = (rule: ScheduleRule, day: number | null): ScheduleForm => ({
  everyMonths: String(rule.everyMonths),
  anchorMonth: String(rule.anchorMonth),
  day: day === null ? '' : String(day),
  validFrom: periodToMonthInput(rule.validFrom),
  validTo: periodToMonthInput(rule.validTo),
});

/** Form texts → API fields. The day goes back under the rule's own name (expectedDay, dueDay). */
export function scheduleInput(s: ScheduleForm) {
  const everyMonths = Number(s.everyMonths);
  return {
    everyMonths,
    // monthly rules do not need a reference month; keep a valid one
    anchorMonth: everyMonths === 1 ? 1 : Number(s.anchorMonth),
    day: s.day.trim() === '' ? null : Number(s.day),
    validFrom: monthInputToPeriod(s.validFrom) || undefined,
    validTo: monthInputToPeriod(s.validTo) || null,
  };
}

type ScheduleFieldsProps = {
  table: string;
  /** Column of the day for its label: expected_day, due_day. */
  dayColumn: string;
  value: ScheduleForm;
  onChange: (value: ScheduleForm) => void;
  errors: Record<string, string>;
  /** API name of the day field, to show its error. */
  dayField: string;
};

/** Frequency, reference month (only if not monthly), day, and validity months. */
export function ScheduleFields({ table, dayColumn, value, onChange, errors, dayField }: ScheduleFieldsProps) {
  const set = (field: keyof ScheduleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [field]: e.target.value });
  return (
    <>
      <Field label={columnLabel(table, 'every_months')} error={errors.everyMonths}>
        {(p) => (
          <select {...p} value={value.everyMonths} onChange={set('everyMonths')}>
            {EVERY_MONTHS.map((n) => (
              <option key={n} value={n}>
                {t(`every_months_${n}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {value.everyMonths !== '1' && (
        <Field label={columnLabel(table, 'anchor_month')} error={errors.anchorMonth}>
          {(p) => (
            <select {...p} value={value.anchorMonth} onChange={set('anchorMonth')} title={t('anchor_month_help')}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={columnLabel(table, dayColumn)} error={errors[dayField]}>
        {(p) => <input {...p} inputMode="numeric" value={value.day} onChange={set('day')} />}
      </Field>
      <Field label={columnLabel(table, 'valid_from')} error={errors.validFrom}>
        {(p) => <input {...p} type="month" value={value.validFrom} onChange={set('validFrom')} />}
      </Field>
      <Field label={columnLabel(table, 'valid_to')} error={errors.validTo}>
        {(p) => <input {...p} type="month" value={value.validTo} onChange={set('validTo')} title={t('valid_to_help')} />}
      </Field>
    </>
  );
}

/** "Mensual", "Anual · desde enero 2027", "Bimestral · hasta marzo 2027" (for the row note). */
export function describeSchedule(rule: ScheduleRule): string[] {
  const parts = [t(`every_months_${rule.everyMonths}`)];
  if (rule.everyMonths === 12) parts[0] = `${parts[0]} (${monthName(rule.anchorMonth)})`;
  const now = currentPeriodIso();
  if (rule.validFrom > now) parts.push(t('since_month', { month: formatMonth(rule.validFrom) }));
  if (rule.validTo) parts.push(t('until_month', { month: formatMonth(rule.validTo) }));
  return parts;
}

/** A rule whose last month already passed. */
export const hasEnded = (rule: { validTo: string | null }) => rule.validTo !== null && rule.validTo < currentPeriodIso();
