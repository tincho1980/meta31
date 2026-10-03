// UI labels come from docs/glosario-es.yml (RNF-17). Never hardcode texts in components.
import raw from '../../../docs/glosario-es.yml';

type Glossary = {
  ui: Record<string, string>;
  tables: Record<string, { label: string; plural: string; columns: Record<string, string> }>;
  enums: Record<string, Record<string, string>>;
};

const glossary = raw as Glossary;

/** UI text, with `{variable}` substitution. */
export function t(key: string, vars: Record<string, string> = {}): string {
  const text = glossary.ui[key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`Missing key ui.${key} in docs/glosario-es.yml`);
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

/** Label of an enum value. */
export function enumLabel(enumName: string, value: string): string {
  return glossary.enums[enumName]?.[value] ?? value;
}
