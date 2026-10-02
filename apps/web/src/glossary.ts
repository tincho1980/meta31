// Etiquetas de la interfaz: salen de docs/glosario-es.yml (RNF-17). No hardcodear textos en componentes.
import raw from '../../../docs/glosario-es.yml';

type Glossary = {
  ui: Record<string, string>;
  tables: Record<string, { label: string; plural: string; columns: Record<string, string> }>;
  enums: Record<string, Record<string, string>>;
};

const glossary = raw as Glossary;

/** Texto de la interfaz, con reemplazo de `{variable}`. */
export function t(key: string, vars: Record<string, string> = {}): string {
  const text = glossary.ui[key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`Falta la clave ui.${key} en docs/glosario-es.yml`);
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

/** Etiqueta de un valor de enum. */
export function enumLabel(enumName: string, value: string): string {
  return glossary.enums[enumName]?.[value] ?? value;
}
