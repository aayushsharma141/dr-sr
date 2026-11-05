import { describe, expect, it } from 'vitest'
import { istToday, withDoctorTitle } from '../format'

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
