/** Un período es un mes, representado como 'YYYY-MM-01' (D6). */
export type Period = `${number}-${string}-01`;

export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Fecha de hoy ('YYYY-MM-DD') en la zona horaria de Buenos Aires. */
export function todayInBuenosAires(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Mes en curso en Buenos Aires. */
export function currentPeriod(now: Date = new Date()): Period {
  return `${todayInBuenosAires(now).slice(0, 7)}-01` as Period;
}
