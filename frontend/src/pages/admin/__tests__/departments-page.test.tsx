import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DepartmentsPage } from '../DepartmentsPage'

const mocks = vi.hoisted(() => ({
  assignMutate: vi.fn(),
  assignments: {} as Record<number, unknown>,
}))

const department = (id: number, name_en: string, is_active = true) => ({
  id,
  name_en,
  name_hi: null,
  description: null,
  is_active,
  version_id: 1,
  created_at: '2026-11-05T00:00:00Z',
  updated_at: '2026-11-05T00:00:00Z',
})

vi.mock('../../../components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Admin', role: 'ADMIN' } }),
  useDepartments: () => ({
    data: [department(1, 'Physiotherapy'), department(2, 'Ophthalmology')],
    isPending: false,
  }),
  useDoctors: () => ({
    data: [
      { id: 10, name_en: 'Dr. First', is_active: true, version_id: 3 },
      { id: 20, name_en: 'Dr. Second', is_active: true, version_id: 7 },
    ],
  }),
  useCreateDepartment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignDoctorDepartments: () => ({ mutateAsync: mocks.assignMutate, isPending: false }),
  useDoctorDepartments: (doctorId: number | null) => ({
    data: doctorId === null ? undefined : mocks.assignments[doctorId],
    isError: false,
  }),
}))

async function chooseDoctor(name: string) {
  await userEvent.selectOptions(screen.getByLabelText('Doctor'), name)
}

describe('DepartmentsPage assignments', () => {
  beforeEach(() => {
    mocks.assignMutate.mockReset()
    mocks.assignMutate.mockResolvedValue([])
    for (const key of Object.keys(mocks.assignments)) delete mocks.assignments[Number(key)]
  })

  it('cannot save one doctor’s departments onto another while they load', async () => {
    mocks.assignments[10] = [department(1, 'Physiotherapy')]
    render(<DepartmentsPage />)

    await chooseDoctor('Dr. First')
    expect(await screen.findByRole('checkbox', { name: 'Physiotherapy' })).toBeChecked()

    // Dr. Second's assignments have not loaded, so assignments[20] is still undefined.
    await chooseDoctor('Dr. Second')

    expect(screen.getByRole('checkbox', { name: 'Physiotherapy' })).not.toBeChecked()
    const save = screen.getByRole('button', { name: 'Save assignments' })
    expect(save).toBeDisabled()
    await userEvent.click(save)
    expect(mocks.assignMutate).not.toHaveBeenCalled()
  })

  it('shows an inactive membership so it can be removed', async () => {
    mocks.assignments[10] = [department(1, 'Physiotherapy'), department(9, 'Closed Clinic', false)]
    render(<DepartmentsPage />)

    await chooseDoctor('Dr. First')
    const inactive = await screen.findByRole('checkbox', { name: 'Closed Clinic (Inactive)' })
    expect(inactive).toBeChecked()

    await userEvent.click(inactive)
    await userEvent.click(screen.getByRole('button', { name: 'Save assignments' }))

    await waitFor(() =>
      expect(mocks.assignMutate).toHaveBeenCalledWith({
        doctorId: 10,
        body: { department_ids: [1], version_id: 3 },
      }),
    )
  })
})
