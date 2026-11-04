import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { InlineAlert } from '../InlineAlert'

describe('InlineAlert', () => {
  it('renders errors with role=alert', () => {
    render(<InlineAlert tone="error">Backup failed</InlineAlert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Backup failed')
  })

  it('renders success and info with role=status', () => {
    const { rerender } = render(<InlineAlert tone="success">Saved</InlineAlert>)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')

    rerender(<InlineAlert tone="info">Working</InlineAlert>)
    expect(screen.getByRole('status')).toHaveTextContent('Working')
  })

  it('shows a labelled dismiss button only when onDismiss is given', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<InlineAlert tone="error">x</InlineAlert>)
    expect(screen.queryByRole('button', { name: 'Dismiss message' })).not.toBeInTheDocument()

    rerender(
      <InlineAlert tone="error" onDismiss={onDismiss}>
        x
      </InlineAlert>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('forwards the id for aria-describedby or aria-errormessage use', () => {
    render(
      <InlineAlert tone="error" id="form-error">
        Name is required
      </InlineAlert>
    )
    expect(document.getElementById('form-error')).toHaveTextContent('Name is required')
  })
})
