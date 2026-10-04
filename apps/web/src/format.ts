// Display helpers. Amounts and rates arrive as decimal strings and are formatted as text:
// never converted to a JS number (RNF-10).

/**
 * '1450.500000' → '1.450,50' (es-AR): thousands with dots, decimal comma, trailing zeros
 * trimmed down to `minDecimals`.
 */
export function formatDecimal(value: string, minDecimals = 2): string {
  const negative = value.startsWith('-');
  const [intPart = '0', decPart = ''] = value.replace(/^-/, '').split('.');
  let decimals = decPart.replace(/0+$/, '');
  if (decimals.length < minDecimals) decimals = decimals.padEnd(minDecimals, '0');
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${decimals ? `,${decimals}` : ''}`;
}

/**
 * What the user types → decimal string for the API. Accepts '1450,5', '1.450,50' and '1450.5'.
 * With a comma, dots are thousands separators; without one, a dot is the decimal point.
 */
export function parseDecimalInput(input: string): string {
  const v = input.trim().replace(/\s/g, '');
  return v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
}

/** '2026-10-04' → '04/10/2026'. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Today in Buenos Aires as 'YYYY-MM-DD' (default for date inputs). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}
