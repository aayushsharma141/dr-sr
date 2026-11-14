// Small display helpers shared across screens.

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's hospital business date as YYYY-MM-DD. toISOString() gives the UTC date, a day behind until 05:30 IST. */
export function istToday(now: Date = new Date()): string {
  const parts = IST_DATE.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * How a queue token reads on screen. A doctor with a cabin code gets cabin letter plus a
 * two-digit serial (A-05); without one it stays #5. No token yet (the patient has not been
 * checked in) is an em dash, never "null".
 */
export function formatToken(
  tokenNumber: number | null | undefined,
  cabinCode?: string | null,
): string {
  if (tokenNumber == null) return '—'
  const code = cabinCode?.trim()
  return code ? `${code}-${String(tokenNumber).padStart(2, '0')}` : `#${tokenNumber}`
}

/** The name with one "Dr." title; staff often type it into the stored name. */
export function withDoctorTitle(name: string): string {
  const trimmed = name.trim()
  return /^dr(\.\s*|\s+)/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`
}
