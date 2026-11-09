// Time units and duration conversion (stored in tenths of a minute).
// Ported from MPXJ (MPPUtility.getDurationTimeUnits, getAdjustedDuration, getDuration), LGPL-2.1.

// Same order as the MPXJ TimeUnit enum, needed for TimeUnit.getInstance(n).
export const TIME_UNITS = [
  'MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS', 'PERCENT', 'YEARS',
  'ELAPSED_MINUTES', 'ELAPSED_HOURS', 'ELAPSED_DAYS', 'ELAPSED_WEEKS', 'ELAPSED_MONTHS', 'ELAPSED_YEARS', 'ELAPSED_PERCENT',
];

const DURATION_UNIT_CODES = {
  3: 'MINUTES', 4: 'ELAPSED_MINUTES', 5: 'HOURS', 6: 'ELAPSED_HOURS', 7: 'DAYS', 8: 'ELAPSED_DAYS',
  9: 'WEEKS', 10: 'ELAPSED_WEEKS', 11: 'MONTHS', 12: 'ELAPSED_MONTHS', 19: 'PERCENT', 20: 'ELAPSED_PERCENT',
};

export function durationTimeUnits(type, projectDefault = null) {
  const code = type & 0x1f;
  if (code === 21) return projectDefault ?? 'DAYS';
  return DURATION_UNIT_CODES[code] ?? 'DAYS';
}

// "Raw" duration in tenths of a minute with fixed divisors (8-hour day).
export function rawDuration(value, units) {
  const divisor = {
    MINUTES: 10, ELAPSED_MINUTES: 10, HOURS: 600, ELAPSED_HOURS: 600, DAYS: 4800, ELAPSED_DAYS: 14400,
    WEEKS: 24000, ELAPSED_WEEKS: 100800, MONTHS: 96000, ELAPSED_MONTHS: 432000,
  }[units];
  return { value: divisor ? value / divisor : value, units };
}

// Duration using the project calendar (minutes per day/week, days per month).
// calendar: { minutesPerDay, minutesPerWeek, daysPerMonth }.
export function adjustedDuration(calendar, value, units) {
  if (value === -1) return null;
  const ratio = (units, per) => ({ value: per !== 0 ? value / per : 0, units });
  switch (units) {
    case 'DAYS': return ratio(units, calendar.minutesPerDay * 10);
    case 'ELAPSED_DAYS': return { value: value / (24 * 600), units };
    case 'WEEKS': return ratio(units, calendar.minutesPerWeek * 10);
    case 'ELAPSED_WEEKS': return { value: value / (60 * 24 * 7 * 10), units };
    case 'MONTHS': return ratio(units, calendar.minutesPerDay * calendar.daysPerMonth * 10);
    case 'ELAPSED_MONTHS': return { value: value / (60 * 24 * 30 * 10), units };
    default: return rawDuration(value, units);
  }
}
