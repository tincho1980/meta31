/**
 * The month's path (manual de marca): one dot per day, left to right on the green header, with
 * a girasol flag at the end. Past days are full crema dots, the rest faded; today is a girasol
 * dot with a halo. Days with a due commitment get a small girasol mark below (salvia-2 if past).
 * It only lives inside the green header.
 */
export function MonthPath({ days, today, dueDays }: { days: number; today: number | null; dueDays: ReadonlySet<number> }) {
  const labelled = new Set([1, 8, 15, 22, days, ...(today ? [today] : [])]);
  return (
    <div className="month-path" aria-hidden="true">
      <div className="month-path-dots">
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const state = today === null ? 'future' : day < today ? 'past' : day === today ? 'today' : 'future';
          return (
            <span key={day} className={`day ${state}`}>
              <span className="dot" />
              {dueDays.has(day) && <span className="due" />}
              {labelled.has(day) && <span className="day-label">{day}</span>}
            </span>
          );
        })}
        <svg className="flag" width="14" height="18" viewBox="0 0 14 18">
          <path d="M2 1v16" stroke="var(--crema)" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M2.5 1.5h9l-2.5 3.5 2.5 3.5h-9z" fill="var(--girasol)" />
        </svg>
      </div>
    </div>
  );
}
