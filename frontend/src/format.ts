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
  return code ? `${code}-${tokenNumber}` : `#${tokenNumber}`
}

/** Paise as rupees with two decimals and Indian digit grouping: 4000050 -> "₹40,000.50", -5050 -> "-₹50.50". */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN')
  return `${sign}₹${rupees}.${String(abs % 100).padStart(2, '0')}`
}

/** A timestamp in IST for receipts and ledgers: "14 Nov 2026, 10:30 am". */
export function formatIst(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

/** Paise as a rupee string for an input box: 40000 -> "400.00". */
export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2)
}

/** Whole rupees with up to two decimals ("350", "350.5", "350.50"); anything else is rejected. */
export function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null
  const paise = Math.round(Number(trimmed) * 100)
  return paise > 0 ? paise : null
}

/** The name with one "Dr." title; staff often type it into the stored name. */
export function withDoctorTitle(name: string): string {
  const trimmed = name.trim()
  return /^dr(\.\s*|\s+)/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`
}
