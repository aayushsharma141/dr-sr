import { describe, expect, it } from 'vitest'
import { formatPaise, formatToken, istToday, withDoctorTitle } from '../format'

describe('formatToken', () => {
  it('shows cabin letter and serial when the doctor has a cabin code', () => {
    expect(formatToken(5, 'A')).toBe('A-5')
    expect(formatToken(14, 'B')).toBe('B-14')
    expect(formatToken(105, 'C')).toBe('C-105')
  })

  it('stays #n without a cabin code', () => {
    expect(formatToken(5)).toBe('#5')
    expect(formatToken(5, null)).toBe('#5')
    expect(formatToken(5, '  ')).toBe('#5')
  })

  it('is a dash, never "null", before the patient is checked in', () => {
    expect(formatToken(null)).toBe('—')
    expect(formatToken(undefined, 'A')).toBe('—')
  })

  it('keeps a token of zero rather than treating it as missing', () => {
    expect(formatToken(0, 'A')).toBe('A-0')
  })
})

describe('istToday', () => {
  it('moves to the next date at midnight IST, not midnight UTC', () => {
    expect(istToday(new Date('2026-11-05T18:29:00Z'))).toBe('2026-11-05') // 23:59 IST
    expect(istToday(new Date('2026-11-05T18:30:00Z'))).toBe('2026-11-06') // 00:00 IST
    expect(istToday(new Date('2026-11-05T19:30:00Z'))).toBe('2026-11-06') // 01:00 IST
  })

  it('keeps the year boundary on IST', () => {
    expect(istToday(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
  })
})

describe('withDoctorTitle', () => {
  it.each([
    ['Anil Kumar', 'Dr. Anil Kumar'],
    ['Dr. Anil Kumar', 'Dr. Anil Kumar'],
    ['Dr Anil Kumar', 'Dr Anil Kumar'],
    ['DR. ANIL KUMAR', 'DR. ANIL KUMAR'],
    ['Drishti Sharma', 'Dr. Drishti Sharma'],
  ])('shows %s as %s', (stored, shown) => {
    expect(withDoctorTitle(stored)).toBe(shown)
  })
})

describe('formatPaise', () => {
  it('formats positive paise with Indian digit grouping', () => {
    expect(formatPaise(0)).toBe('₹0.00')
    expect(formatPaise(50)).toBe('₹0.50')
    expect(formatPaise(100)).toBe('₹1.00')
    expect(formatPaise(35000)).toBe('₹350.00')
    expect(formatPaise(4000050)).toBe('₹40,000.50')
    expect(formatPaise(10000000)).toBe('₹1,00,000.00')
  })

  it('formats negative paise correctly with minus sign before currency symbol (S16)', () => {
    expect(formatPaise(-50)).toBe('-₹0.50')
    expect(formatPaise(-100)).toBe('-₹1.00')
    expect(formatPaise(-5050)).toBe('-₹50.50')
    expect(formatPaise(-4000050)).toBe('-₹40,000.50')
  })
})
