/**
 * frontend/src/utils/date.ts
 * Universal date formatting utilities for the application.
 * Formats dates as: "1 Jan 2026", "23 Jan 2026" (D MMM YYYY).
 */

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a date string (e.g. "2026-01-01", "2026-01-23", "2026-01-15T06:00:00Z")
 * into "1 Jan 2026", "23 Jan 2026".
 * Handles ISO strings and date-only strings safely without timezone distortion.
 */
export function formatDate(dateInput?: string | Date | null): string {
  if (!dateInput) return '';

  if (typeof dateInput === 'string') {
    // Check for YYYY-MM-DD pattern directly to avoid timezone distortion
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = match[1];
      const monthIndex = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const monthName = MONTHS_SHORT[monthIndex] ?? match[2];
      return `${day} ${monthName} ${year}`;
    }
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return String(dateInput);

  const day = d.getUTCDate();
  const monthName = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${monthName} ${year}`;
}
