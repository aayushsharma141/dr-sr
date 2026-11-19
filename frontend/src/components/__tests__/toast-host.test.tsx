import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastHost, clearToasts, toast } from '../ToastHost'

describe('ToastHost', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearToasts()
  })

  it('renders top-center success and error toasts with proper roles', () => {
    act(() => {
      toast.success('Patient saved successfully.')
      toast.error('Unable to reach server.')
    })

    const host = screen.getByTestId('toast-host')
    expect(host.className).toContain('fixed')
    expect(host.className).toContain('top-4')
    expect(host.className).toContain('left-1/2')
    expect(host.className).toContain('-translate-x-1/2')
    expect(host.className).toContain('print:hidden')

    expect(screen.getByRole('status')).toHaveTextContent('Patient saved successfully.')
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach server.')
  })

  it('auto-dismisses success after 4s and errors after 6s', () => {
    vi.useFakeTimers()

    act(() => {
      toast.success('Saved')
      toast.error('Failed')
    })

    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pauses auto-dismiss while hovered and resumes on mouse leave', () => {
    vi.useFakeTimers()

    act(() => {
      toast.success('Hover test')
    })

    const toastEl = screen.getByRole('status')
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    fireEvent.mouseEnter(toastEl)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Hover test')

    fireEvent.mouseLeave(toastEl)
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Hover test')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('supports manual dismiss, action button, deduplication, and single-host rendering', () => {
    render(<ToastHost />)
    const onAction = vi.fn()

    act(() => {
      toast.success('Duplicate message')
      toast.success('Duplicate message')
      toast.error('Conflict detected', {
        title: 'Save conflict',
        action: { label: 'Reload', onClick: onAction },
      })
    })

    expect(screen.getAllByText('Duplicate message')).toHaveLength(1)
    expect(screen.getByText('Save conflict')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
