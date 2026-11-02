import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../test/dialog-shim'
import { ApiError } from '../../api/client'
import type { PatientOut } from '../../api/types'
import { PatientEditModal } from '../PatientEditModal'

const mocks = vi.hoisted(() => ({ updateMutate: vi.fn() }))

vi.mock('../../api/queries', () => ({
  useUpdatePatient: () => ({ mutateAsync: mocks.updateMutate, isPending: false }),
}))

const patient = {
  id: 101,
  urn: 'TEST-0001',
  full_name: 'Test Patient One',
  guardian_name: 'Test Guardian',
  gender: 'MALE',
  dob: null,
  age_years: 40,
  mobile: '9000000001',
  address: 'Test Address',
  district: 'Test District',
  state: 'Test State',
  emergency_contact: null,
  allergies: 'None reported',
  notes: null,
  version_id: 3,
} as unknown as PatientOut

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PatientEditModal isOpen patient={patient} onClose={onClose} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('PatientEditModal on the shared Modal', () => {
  it('a 409 version conflict keeps the dialog open, keeps the typed values, and does not close', async () => {
    mocks.updateMutate.mockRejectedValueOnce(
      new ApiError(409, 'version_conflict', 'This record was changed by another user.'),
    )
    const { onClose } = renderModal()

    const nameInput = screen.getByLabelText(/Full Name/i)
    fireEvent.change(nameInput, { target: { value: 'Test Patient Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Demographic Changes' }))

    await waitFor(() => expect(mocks.updateMutate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit Patient Demographics' })).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Full Name/i)).toHaveValue('Test Patient Two')
  })

  it('the dialog carries the Radix-Sheet override class so it stays clickable over the preview Sheet', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Edit Patient Demographics' })
    expect(dialog).toHaveClass('pointer-events-auto')
  })

  it('opens with the first field focused (data-autofocus)', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/Full Name/i)).toHaveFocus())
  })
})
