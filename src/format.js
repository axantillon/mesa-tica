/** Exact whole-colón amounts shown with the ₡ symbol and grouped thousands, e.g. ₡7,900. */
export function formatCRC(amount) {
  return `₡${amount.toLocaleString('en-US')}`;
}

/** Restaurant-local date and time, always with the date so different days are never ambiguous. */
export function formatLocalDateTime(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
}
