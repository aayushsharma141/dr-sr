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

/** The name with one "Dr." title; staff often type it into the stored name. */
export function withDoctorTitle(name: string): string {
  const trimmed = name.trim()
  return /^dr(\.\s*|\s+)/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`
}
