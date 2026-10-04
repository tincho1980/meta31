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
 * What the user types → decimal string for the API. Accepts '1450,5', '1.450,50', '480.000'
 * and '1450.5'. With a comma, dots are thousands separators. Without one, dots that group
 * digits by three ('480.000', '1.500.000') are thousands too, as written in Argentina;
 * any other dot is the decimal point.
 */
export function parseDecimalInput(input: string): string {
  const v = input.trim().replace(/\s/g, '');
  if (v.includes(',')) return v.replace(/\./g, '').replace(',', '.');
  return /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v;
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

const SYMBOL: Record<string, string> = { ARS: '$', USD: 'US$', UYU: 'UY$' };

/** Rounds a non-negative decimal string to whole units, half up, without converting to number. */
function roundToUnits(value: string): string {
  const [intPart = '0', decPart = ''] = value.split('.');
  if ((decPart[0] ?? '0') < '5') return intPart;
  const digits = intPart.split('');
  let i = digits.length - 1;
  while (i >= 0 && digits[i] === '9') digits[i--] = '0';
  if (i < 0) digits.unshift('1');
  else digits[i] = String(Number(digits[i]) + 1); // a single digit, not money
  return digits.join('');
}

/**
 * Amount for lists (manual de marca): '1500000.00' ARS → '$ 1.500.000', USD → 'US$ 650',
 * UYU → 'UY$ 12.000'. Whole units, rounded half up, except dollars under 100, which keep
 * their cents: 'US$ 40,00', 'US$ 12,99' (decided 3/10). `income` adds the '+' of what comes
 * in; `estimate` the '~' of an estimated amount.
 */
export function formatMoney(value: string, currency: string, { income = false, estimate = false } = {}): string {
  const negative = value.startsWith('-');
  const abs = value.replace(/^-/, '');
  const [intPart = '0', decPart = ''] = abs.split('.');
  const withCents = currency === 'USD' && intPart.replace(/^0+(?=\d)/, '').length <= 2;
  const units = withCents
    ? `${intPart.replace(/^0+(?=\d)/, '')},${decPart.padEnd(2, '0').slice(0, 2)}`
    : formatDecimal(roundToUnits(abs), 0);
  const prefix = `${estimate ? '~ ' : ''}${income ? '+ ' : ''}`;
  return `${prefix}${negative ? '-' : ''}${SYMBOL[currency] ?? currency} ${units}`;
}

/** '2026-10-01' → 'octubre 2026'. */
export function formatMonth(period: string): string {
  const [y, m] = period.split('-');
  const name = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(y), Number(m) - 1, 1)),
  );
  return `${name} ${y}`;
}

/** Name of a month of the year (1–12): 3 → 'marzo'. */
export function monthName(month: number): string {
  return formatMonth(`2000-${String(month).padStart(2, '0')}-01`).replace(/ \d+$/, '');
}

/** Period ↔ value of an <input type="month">: '2026-10-01' ↔ '2026-10'. */
export const periodToMonthInput = (period: string | null): string => (period ? period.slice(0, 7) : '');
export const monthInputToPeriod = (value: string): string => (value ? `${value}-01` : '');

/** Current month in Buenos Aires as a period. */
export const currentPeriodIso = (): string => `${todayIso().slice(0, 7)}-01`;

/** Shifts an <input type="month"> value by whole months: ('2026-10', -3) → '2026-07'. */
export function addMonthsToMonthInput(value: string, delta: number): string {
  const [y, m] = value.split('-').map(Number);
  const index = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** UVA amount: '1500.500000' → '1.500,50 UVA'. */
export const formatUva = (value: string): string => `${formatDecimal(value, 2)} UVA`;

/** Rate in %: '65.000000' → '65 %', '60.500000' → '60,5 %'. */
export const formatPercent = (value: string): string => `${formatDecimal(value, 0)} %`;

/** '2026-10-05' → 'lunes 5' (voz de la casa: "Vence el lunes 5"). */
export function formatWeekdayDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  return `${weekday} ${d}`;
}

/**
 * Short amount for the phone's summary cards (manual de marca): '$ 3,25 M', '$ 380 mil',
 * '$ 950'. Integer arithmetic on the whole units, never floats.
 */
export function formatMoneyShort(value: string, currency: string, { income = false } = {}): string {
  const negative = value.startsWith('-');
  const units = BigInt(roundToUnits(value.replace(/^-/, '')));
  let text: string;
  if (units >= 1_000_000n) {
    const hundredths = (units * 100n + 500_000n) / 1_000_000n;
    text = `${hundredths / 100n},${String(hundredths % 100n).padStart(2, '0')} M`;
  } else if (units >= 1_000n) {
    text = `${(units + 500n) / 1_000n} mil`;
  } else {
    text = String(units);
  }
  return `${income ? '+ ' : ''}${negative ? '-' : ''}${SYMBOL[currency] ?? currency} ${text}`;
}

/** Sum of decimal strings with up to 2 decimals, exact (integer cents), as a 2-decimal string. */
export function sumDecimals(values: readonly string[]): string {
  const cents = (v: string) => {
    const negative = v.startsWith('-');
    const [i = '0', d = ''] = v.replace(/^-/, '').split('.');
    const c = BigInt(i) * 100n + BigInt((d + '00').slice(0, 2));
    return negative ? -c : c;
  };
  const total = values.reduce((acc, v) => acc + cents(v), 0n);
  const abs = total < 0n ? -total : total;
  return `${total < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * a × b for decimal strings, rounded half up to 2 decimals, exact (BigInt): the USD part of a card
 * statement in pesos at a rate. Inputs with up to 6 decimals.
 */
export function multiplyDecimals(a: string, b: string): string {
  const scaled = (v: string) => {
    const [i = '0', d = ''] = v.split('.');
    return BigInt(i) * 1_000_000n + BigInt((d + '000000').slice(0, 6));
  };
  const product = scaled(a) * scaled(b); // scale 10^12
  const cents = (product + 5_000_000_000n) / 10_000_000_000n; // to scale 10^2, half up
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** Same day next month, clamped to its last day: '2026-10-31' → '2026-11-30'. */
export function nextMonthSameDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = addMonthsToMonthInput(`${y}-${String(m).padStart(2, '0')}`, 1);
  const [ty, tm] = target.split('-').map(Number);
  const last = new Date(Date.UTC(ty!, tm!, 0)).getUTCDate();
  return `${target}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}
