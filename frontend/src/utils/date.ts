import { MONTHS_SHORT } from '../store';

export function formatDate(dateInput?: string | Date | null): string {
  if (!dateInput) return '';

  if (typeof dateInput === 'string') {
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
