import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { PatientExportPage } from '../admin/PatientExportPage'
import { PatientExportDialog } from '../../components/admin/PatientExportDialog'

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'System Administrator', role: 'ADMIN' }, isLoading: false }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../api/branding', () => ({
  useClinicBranding: () => ({
    trustNameEn: 'Sri Vashishtha Kalyan Trust',
    trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
    hospitalName: 'Kalyan Hospital',
    address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
    locationLine: 'Ara, Bhojpur, Bihar',
  }),
}))

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PatientExportPage and PatientExportDialog', () => {
  let originalFetch: typeof global.fetch
  let originalCreateObjectURL: typeof window.URL.createObjectURL
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL

  beforeEach(() => {
    originalFetch = global.fetch
    originalCreateObjectURL = window.URL.createObjectURL
    originalRevokeObjectURL = window.URL.revokeObjectURL

    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-export')
    window.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('renders PatientExportPage and opens export dialog on button click', async () => {
    renderWithProviders(<PatientExportPage />)

    expect(screen.getByRole('heading', { name: /patient export centre/i })).toBeInTheDocument()
    const openBtn = screen.getByRole('button', { name: /export patient dataset/i })
    expect(openBtn).toBeInTheDocument()

    fireEvent.click(openBtn)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /export patient dataset/i })).toBeInTheDocument()
  })

  it('defaults clinical fields to unchecked and demographics to checked', () => {
    render(<PatientExportDialog open={true} onClose={vi.fn()} />)

    // Demographics default checked
    const nameCheckbox = screen.getByRole('checkbox', { name: /full name/i })
    const urnCheckbox = screen.getByRole('checkbox', { name: /^urn$/i })
    expect(nameCheckbox).toBeChecked()
    expect(urnCheckbox).toBeChecked()

    // Notes unchecked by default per D-20-18
    const allergiesCheckbox = screen.getByRole('checkbox', { name: /allergies/i })
    expect(allergiesCheckbox).not.toBeChecked()

    // Clinical fields unchecked by default per D-20-16
    const encountersCheckbox = screen.getByRole('checkbox', { name: /encounters/i })
    const vitalsCheckbox = screen.getByRole('checkbox', { name: /vitals/i })
    const rxCheckbox = screen.getByRole('checkbox', { name: /prescriptions/i })
    expect(encountersCheckbox).not.toBeChecked()
    expect(vitalsCheckbox).not.toBeChecked()
    expect(rxCheckbox).not.toBeChecked()

    // Amber clinical warning banner is NOT visible initially
    expect(screen.queryByText(/clinical content access notice/i)).not.toBeInTheDocument()
  })

  it('displays amber clinical export warning callout when any clinical field is checked', () => {
    render(<PatientExportDialog open={true} onClose={vi.fn()} />)

    const encountersCheckbox = screen.getByRole('checkbox', { name: /encounters/i })
    expect(screen.queryByText(/clinical content access notice/i)).not.toBeInTheDocument()

    // Check clinical encounter checkbox
    fireEvent.click(encountersCheckbox)
    expect(encountersCheckbox).toBeChecked()

    // Amber warning banner must appear with UI-SPEC copywriting
    expect(screen.getByText(/clinical content access notice/i)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Access Notice: You are exporting sensitive medical records and consultation notes. This action is permitted for administrative governance and is recorded in the permanent audit trail with your documented justification./i
      )
    ).toBeInTheDocument()

    // Uncheck clinical encounter checkbox -> warning banner disappears
    fireEvent.click(encountersCheckbox)
    expect(encountersCheckbox).not.toBeChecked()
    expect(screen.queryByText(/clinical content access notice/i)).not.toBeInTheDocument()
  })

  it('enforces mandatory reason validation (>= 5 chars) before allowing export', () => {
    render(<PatientExportDialog open={true} onClose={vi.fn()} />)

    const reasonInput = screen.getByLabelText(/Documented Purpose \/ Justification for Export/i)
    const exportButton = screen.getByRole('button', { name: /export patient dataset/i })

    // Disabled initially because reason is empty (< 5 chars)
    expect(exportButton).toBeDisabled()

    // Enter short reason (3 chars)
    fireEvent.change(reasonInput, { target: { value: 'abc' } })
    fireEvent.blur(reasonInput)

    expect(
      screen.getByText(/export justification must be at least 5 characters in length/i)
    ).toBeInTheDocument()
    expect(exportButton).toBeDisabled()

    // Enter valid reason (>= 5 chars)
    fireEvent.change(reasonInput, { target: { value: 'Annual compliance and financial audit' } })
    expect(
      screen.queryByText(/export justification must be at least 5 characters in length/i)
    ).not.toBeInTheDocument()
    expect(exportButton).not.toBeDisabled()
  })

  it('toggles format between CSV and XLSX', () => {
    render(<PatientExportDialog open={true} onClose={vi.fn()} />)

    const csvRadio = screen.getByRole('radio', { name: /csv/i })
    const xlsxRadio = screen.getByRole('radio', { name: /microsoft excel/i })

    expect(csvRadio).toBeChecked()
    expect(xlsxRadio).not.toBeChecked()

    fireEvent.click(xlsxRadio)
    expect(xlsxRadio).toBeChecked()
    expect(csvRadio).not.toBeChecked()
  })

  it('triggers download stream when valid export request is submitted', async () => {
    const mockBlob = new Blob(['col1,col2\nval1,val2'], { type: 'text/csv' })
    const mockResponse = {
      ok: true,
      headers: new Headers({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="patients_export_20261108_120000.csv"',
      }),
      blob: vi.fn().mockResolvedValue(mockBlob),
    }
    global.fetch = vi.fn().mockResolvedValue(mockResponse)

    const handleSuccess = vi.fn()
    const handleClose = vi.fn()

    render(
      <PatientExportDialog
        open={true}
        onClose={handleClose}
        onExportSuccess={handleSuccess}
      />
    )

    // Set filter scope
    const startDateInput = screen.getByLabelText(/start date/i)
    fireEvent.change(startDateInput, { target: { value: '2026-11-01' } })

    const deptSelect = screen.getByLabelText(/department/i)
    fireEvent.change(deptSelect, { target: { value: '1' } })

    // Set justification reason
    const reasonInput = screen.getByLabelText(/Documented Purpose \/ Justification for Export/i)
    fireEvent.change(reasonInput, { target: { value: 'Quarterly board review of physiotherapy outcomes' } })

    const exportBtn = screen.getByRole('button', { name: /export patient dataset/i })
    expect(exportBtn).not.toBeDisabled()

    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/exports',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
        })
      )
    })

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]
    const sentBody = JSON.parse(fetchCall[1]?.body as string)
    expect(sentBody.reason).toBe('Quarterly board review of physiotherapy outcomes')
    expect(sentBody.format).toBe('csv')
    expect(sentBody.scope.start_date).toBe('2026-11-01')
    expect(sentBody.scope.department_id).toBe(1)
    expect(sentBody.fields).toContain('full_name')

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith('patients_export_20261108_120000.csv')
      expect(handleClose).toHaveBeenCalled()
    })
  })
})

