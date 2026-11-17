import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { istToday } from '../../../format'
import { ReceptionDeskTabs } from '../../billing/ReceptionDeskTabs'
import {
  AppointmentStatusBadge,
  getWaitingElapsedMinutes,
  parsePositiveIntParam,
  useDebouncedValue,
  useIstToday,
  type ReceptionStatusKey,
} from '../AppointmentStatusBadge'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('parsePositiveIntParam', () => {
  it('parses valid positive integer strings with optional surrounding whitespace', () => {
    expect(parsePositiveIntParam('12')).toBe(12)
    expect(parsePositiveIntParam(' 42 ')).toBe(42)
    expect(parsePositiveIntParam('1')).toBe(1)
  })

  it('returns null for zero, negative, fractional, non-numeric, empty, or nullish values', () => {
    expect(parsePositiveIntParam('0')).toBeNull()
    expect(parsePositiveIntParam('01')).toBeNull()
    expect(parsePositiveIntParam('-1')).toBeNull()
    expect(parsePositiveIntParam('1.5')).toBeNull()
    expect(parsePositiveIntParam('abc')).toBeNull()
    expect(parsePositiveIntParam('12abc')).toBeNull()
    expect(parsePositiveIntParam('')).toBeNull()
    expect(parsePositiveIntParam('   ')).toBeNull()
    expect(parsePositiveIntParam(null)).toBeNull()
    expect(parsePositiveIntParam(undefined)).toBeNull()
  })
})

describe('getWaitingElapsedMinutes', () => {
  const nowMs = Date.parse('2026-11-17T10:30:00Z')

  it('prefers check_in_at over status_updated_at and created_at', () => {
    expect(
      getWaitingElapsedMinutes(
        {
          check_in_at: '2026-11-17T10:15:00Z',
          status_updated_at: '2026-11-17T10:00:00Z',
          created_at: '2026-11-17T09:00:00Z',
        },
        nowMs,
      ),
    ).toBe(15)
  })

  it('falls back to status_updated_at and then created_at when earlier fields are missing', () => {
    expect(
      getWaitingElapsedMinutes(
        {
          check_in_at: null,
          status_updated_at: '2026-11-17T10:05:30Z',
          created_at: '2026-11-17T09:00:00Z',
        },
        nowMs,
      ),
    ).toBe(24)

    expect(
      getWaitingElapsedMinutes(
        {
          check_in_at: undefined,
          status_updated_at: null,
          created_at: '2026-11-17T09:50:00Z',
        },
        nowMs,
      ),
    ).toBe(40)
  })

  it('clamps future timestamps and invalid or missing dates to 0', () => {
    expect(
      getWaitingElapsedMinutes({ check_in_at: '2026-11-17T11:00:00Z' }, nowMs),
    ).toBe(0)
    expect(
      getWaitingElapsedMinutes({ check_in_at: 'not-a-date' }, nowMs),
    ).toBe(0)
    expect(getWaitingElapsedMinutes({}, nowMs)).toBe(0)
  })
})

describe('useDebouncedValue', () => {
  it('updates after the configured delay and cancels stale timers', () => {
    vi.useFakeTimers()
    const { result, rerender, unmount } = renderHook(
      ({ value, delayMs }) => useDebouncedValue(value, delayMs),
      { initialProps: { value: 'a', delayMs: 200 } },
    )

    expect(result.current).toBe('a')

    rerender({ value: 'ab', delayMs: 200 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('a')

    rerender({ value: 'abc', delayMs: 200 })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('abc')

    rerender({ value: 'abcd', delayMs: 200 })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useIstToday', () => {
  it('returns serverDate when provided and falls back to istToday() otherwise', () => {
    const { result, rerender } = renderHook<string, { serverDate?: string | null }>(
      ({ serverDate }) => useIstToday(serverDate),
      { initialProps: { serverDate: '2026-11-20' } },
    )

    expect(result.current).toBe('2026-11-20')

    rerender({ serverDate: null })
    expect(result.current).toBe(istToday())

    rerender({ serverDate: undefined })
    expect(result.current).toBe(istToday())
  })

  it('rolls over across 00:00 IST on its 60-second interval and cleans up on unmount', () => {
    vi.useFakeTimers()
    // 2026-11-17 23:59:30 IST == 2026-11-17T18:29:30Z
    vi.setSystemTime(new Date('2026-11-17T18:29:30Z'))

    const { result, unmount } = renderHook(() => useIstToday())
    expect(result.current).toBe('2026-11-17')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe('2026-11-18')

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AppointmentStatusBadge', () => {
  const cases: Array<[ReceptionStatusKey, string, string[]]> = [
    ['BOOKED', 'Booked', ['bg-slate-100', 'text-slate-700', 'border-slate-200']],
    ['TO_ARRIVE', 'To arrive', ['bg-amber-50', 'text-amber-800', 'border-amber-200']],
    ['CHECKED_IN', 'Checked In', ['bg-teal-50', 'text-teal-800', 'border-teal-200']],
    ['WAITING', 'Waiting', ['bg-amber-50', 'text-amber-800', 'border-amber-200']],
    ['IN_CABIN', 'In Cabin', ['bg-blue-50', 'text-blue-800', 'border-blue-200']],
    ['COMPLETED', 'Completed', ['bg-emerald-50', 'text-emerald-800', 'border-emerald-200']],
    ['NO_SHOW', 'No-show', ['bg-orange-50', 'text-orange-800', 'border-orange-200']],
    ['RESCHEDULED', 'Rescheduled', ['bg-purple-50', 'text-purple-800', 'border-purple-200']],
    ['CANCELLED', 'Cancelled', ['bg-red-50', 'text-red-800', 'border-red-200']],
  ]

  it.each(cases)('renders %s with unified UX-04 semantic classes', (status, expectedLabel, classes) => {
    render(<AppointmentStatusBadge status={status} />)
    const badge = screen.getByText(expectedLabel)
    for (const cls of classes) {
      expect(badge).toHaveClass(cls)
    }
    expect(badge).toHaveClass('text-xs')
  })

  it('supports custom label and className overrides', () => {
    render(
      <AppointmentStatusBadge
        status="CHECKED_IN"
        label="Arrived"
        className="ml-2"
      />,
    )
    const badge = screen.getByText('Arrived')
    expect(badge).toHaveClass('bg-teal-50', 'text-teal-800', 'border-teal-200', 'ml-2')
  })
})

describe('ReceptionDeskTabs', () => {
  it('hides Daily Collection Report for admin users while keeping ledger, dues, and receipts tabs', () => {
    render(
      <MemoryRouter>
        <ReceptionDeskTabs activeTab="receipts" isAdmin={true} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Receipts Ledger/i })).toHaveAttribute(
      'href',
      '/reception/billing?tab=ledger',
    )
    expect(screen.getByRole('link', { name: /Pending Dues/i })).toHaveAttribute(
      'href',
      '/reception/billing?tab=dues',
    )
    expect(screen.getByRole('link', { name: /Receipts Desk/i })).toHaveAttribute(
      'href',
      '/reception/receipts',
    )
    expect(
      screen.queryByRole('link', { name: /Daily Collection Report/i }),
    ).not.toBeInTheDocument()
  })

  it('shows Daily Collection Report for non-admin reception users', () => {
    render(
      <MemoryRouter>
        <ReceptionDeskTabs activeTab="receipts" isAdmin={false} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Billing & Checkout/i })).toHaveAttribute(
      'href',
      '/reception/billing',
    )
    expect(screen.getByRole('link', { name: /Pending Dues/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Receipts Desk/i })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Daily Collection Report/i }),
    ).toHaveAttribute('href', '/reception/reports')
  })
})
