import { StrictMode, useState } from 'react'
import { createPortal } from 'react-dom'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import { Modal } from '../Modal'

function Harness({
  onClosed = vi.fn(),
  dismiss,
  busy,
}: {
  onClosed?: () => void
  dismiss?: 'closerequest' | 'any' | 'none'
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        title="Record Payment"
        dismiss={dismiss}
        busy={busy}
        onClose={() => {
          onClosed()
          setOpen(false)
        }}
      >
        <label>
          Amount
          <input defaultValue="" />
        </label>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </Modal>
    </>
  )
}

describe('Modal (native dialog + jsdom shim)', () => {
  it('is hidden while closed and exposes a named dialog while open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Record Payment' })
    expect(dialog).toHaveAttribute('open')
    expect(dialog).not.toHaveAttribute('role') // native semantics, no role="dialog"
    expect(dialog).not.toHaveAttribute('aria-modal')
  })

  it('Esc closes once, calls onClose once, and returns focus to the opener', async () => {
    const user = userEvent.setup()
    const onClosed = vi.fn()
    render(<Harness onClosed={onClosed} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('the Close button and a parent-driven close do not double-fire onClose', async () => {
    const user = userEvent.setup()
    const onClosed = vi.fn()
    render(<Harness onClosed={onClosed} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' })) // parent flips open=false itself
    await new Promise((r) => setTimeout(r, 20)) // let the async close event fire
    expect(onClosed).toHaveBeenCalledTimes(1) // our own close() must not call onClose
  })

  it('ignores Esc while busy or dismiss="none"', async () => {
    const user = userEvent.setup()
    const onClosed = vi.fn()
    const { rerender } = render(<Harness onClosed={onClosed} busy />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    await new Promise((r) => setTimeout(r, 20))
    expect(onClosed).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    rerender(<Harness onClosed={onClosed} dismiss="none" />)
  })

  it('closes on backdrop press only with dismiss="any"', async () => {
    const onClosed = vi.fn()
    render(<Harness onClosed={onClosed} dismiss="any" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.pointerDown(screen.getByLabelText('Amount')) // press inside the panel, release on backdrop
    fireEvent.click(dialog)
    await new Promise((r) => setTimeout(r, 20))
    expect(onClosed).not.toHaveBeenCalled() // drag-select that ends on the backdrop must not dismiss
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
  })

  it('survives React StrictMode double effects without calling onClose', async () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <Modal open title="Strict" onClose={onClose}>
          <p>body</p>
        </Modal>
      </StrictMode>,
    )
    await new Promise((r) => setTimeout(r, 30)) // the stale async close event from the dev-only cleanup
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Strict' })).toHaveAttribute('open')
  })

  it('sequential dialogs: payment closes, receipt opens, Esc closes only the receipt', async () => {
    const user = userEvent.setup()
    function Flow() {
      const [step, setStep] = useState<'idle' | 'payment' | 'receipt'>('idle')
      return (
        <>
          <button type="button" onClick={() => setStep('payment')}>
            Collect
          </button>
          <Modal open={step === 'payment'} title="Record Payment" onClose={() => setStep('idle')}>
            <button type="button" onClick={() => setStep('receipt')}>
              Collect &amp; Issue Receipt
            </button>
          </Modal>
          {createPortal(
            <Modal open={step === 'receipt'} title="Receipt" onClose={() => setStep('idle')}>
              <p>RCP-1</p>
            </Modal>,
            document.body,
          )}
        </>
      )
    }
    render(<Flow />)
    await user.click(screen.getByRole('button', { name: 'Collect' }))
    await user.click(screen.getByRole('button', { name: /Collect & Issue Receipt/ }))
    expect(screen.queryByRole('dialog', { name: 'Record Payment' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Receipt' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('moves initial focus to the data-autofocus control and restores the opener if unmounted while open', async () => {
    const user = userEvent.setup()
    function Cond() {
      const [show, setShow] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setShow(true)}>
            Open cond
          </button>
          {show && (
            <Modal open title="Cond" onClose={() => setShow(false)}>
              <input aria-label="first" data-autofocus />
              <button type="button" onClick={() => setShow(false)}>
                Unmount now
              </button>
            </Modal>
          )}
        </>
      )
    }
    render(<Cond />)
    const opener = screen.getByRole('button', { name: 'Open cond' })
    await user.click(opener)
    expect(screen.getByLabelText('first')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Unmount now' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('falls back to cancel -> close when requestClose() is missing (Chrome/Edge before 134)', async () => {
    const user = userEvent.setup()
    const proto = HTMLDialogElement.prototype as unknown as { requestClose?: unknown }
    const original = proto.requestClose
    delete proto.requestClose
    try {
      const onClosed = vi.fn()
      render(<Harness onClosed={onClosed} />)
      await user.click(screen.getByRole('button', { name: 'Open' }))
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
    } finally {
      proto.requestClose = original
    }
  })

  it('print dialogs portal to <body> with the print-portal class and page name', () => {
    const { container } = render(
      <Modal open print="receipt" title="Receipt" onClose={() => {}}>
        <p>RCP-1</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Receipt' })
    expect(container.contains(dialog)).toBe(false) // portaled out of the app root
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toHaveClass('print-portal')
    expect(dialog).toHaveAttribute('data-print-page', 'receipt')
  })

  it('resets form state each time it reopens', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.type(screen.getByLabelText('Amount'), '500')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByLabelText('Amount')).toHaveValue('')
  })

  it('a closed print dialog is not in the DOM at all (closed prints must never hide the app)', () => {
    const { container } = render(
      <Modal open={false} print="a4" title="Slip" onClose={() => {}}>
        <p>slip</p>
      </Modal>,
    )
    expect(document.querySelector('dialog.print-portal')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('shows a visible text label for the variant, so colour is not the only signal', () => {
    render(
      <Modal open variant="error" title="Payment failed" onClose={() => {}}>
        <p>x</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Payment failed' })).toHaveAttribute('data-variant', 'error')
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('destructive confirmation: Esc and backdrop are blocked and the safe action gets focus', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <Modal open variant="destructive" title="Delete plan?" dismiss="none" onClose={onClose}>
        <button type="button" data-autofocus>Keep plan</button>
        <button type="button" onClick={onConfirm}>Delete plan</button>
      </Modal>,
    )
    const keep = screen.getByRole('button', { name: 'Keep plan' })
    await waitFor(() => expect(keep).toHaveFocus())

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('long English and Hindi content scrolls inside the dialog instead of spilling out', () => {
    const long = 'परीक्षण '.repeat(400) + 'Lorem ipsum dolor sit amet '.repeat(200)
    render(
      <Modal open title="Long content" onClose={() => {}}>
        <p>{long}</p>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Long content' })
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]')
    const body = dialog.querySelector('.overflow-y-auto')
    expect(body).not.toBeNull()
    expect(body).toHaveClass('break-words')
  })
})
