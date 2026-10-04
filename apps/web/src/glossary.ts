// UI labels come from docs/glosario-es.yml (RNF-17). Never hardcode texts in components.
import raw from '../../../docs/glosario-es.yml';
import { ApiError } from './api';

type Glossary = {
  ui: Record<string, string>;
  derived: Record<string, string>;
  tables: Record<string, { label: string; plural: string; columns: Record<string, string> }>;
  enums: Record<string, Record<string, string>>;
};

const glossary = raw as Glossary;

function missing(key: string): string {
  if (import.meta.env.DEV) console.warn(`Missing key ${key} in docs/glosario-es.yml`);
  return key;
}

/** UI text, with `{variable}` substitution. */
export function t(key: string, vars: Record<string, string> = {}): string {
  const text = glossary.ui[key];
  if (text === undefined) return missing(`ui.${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

/** Label of an enum value. */
export function enumLabel(enumName: string, value: string): string {
  return glossary.enums[enumName]?.[value] ?? missing(`enums.${enumName}.${value}`);
}

/** Table label (singular or plural). */
export function tableLabel(table: string, plural = false): string {
  const entry = glossary.tables[table];
  if (!entry) return missing(`tables.${table}`);
  return plural ? entry.plural : entry.label;
}

/** Column label of a table. */
export function columnLabel(table: string, column: string): string {
  return glossary.tables[table]?.columns[column] ?? missing(`tables.${table}.columns.${column}`);
}

/** Message for a field validation code (from zod or the API). */
export function fieldMessage(code: string): string {
  return glossary.ui[`invalid_${code}`] ?? glossary.ui.invalid_default ?? code;
}

/** Message for a failed API call: the specific reason if there is one, else the error code. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body) {
    const { reason, error } = err.body;
    return (reason && glossary.ui[`error_${reason}`]) || glossary.ui[`error_${error}`] || t('error_generic');
  }
  return t('error_generic');
}

/** Label of a derived value (not a column): theoretical installment, remaining principal… */
export function derivedLabel(key: string): string {
  return glossary.derived[key] ?? missing(`derived.${key}`);
}
