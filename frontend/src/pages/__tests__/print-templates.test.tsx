import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { PrintTemplatesPage } from '../admin/PrintTemplatesPage'
import type { PrintTemplateOut } from '../../api/types'

const mockTemplates: PrintTemplateOut[] = [
  {
    id: 1,
    document_type: 'prescription',
    header_en: 'Kalyan Hospital Physiotherapy Department',
    header_hi: 'कल्याण हॉस्पिटल फिजियोथेरेपी विभाग',
    footer_en: 'Emergency 24x7: +91 6182 000000',
    footer_hi: 'आपातकालीन 24x7: +91 6182 000000',
    version: 1,
    updated_at: '2026-11-08T00:00:00Z',
  },
  {
    id: 2,
    document_type: 'receipt',
    header_en: 'Kalyan Hospital Accounts Department',
    header_hi: 'कल्याण हॉस्पिटल लेखा विभाग',
    footer_en: 'Thank you for your visit.',
    footer_hi: 'धन्यवाद! आपके शीघ्र स्वास्थ्य लाभ की कामना करते हैं।',
    version: 2,
    updated_at: '2026-11-08T00:00:00Z',
  },
  {
    id: 3,
    document_type: 'registration_card',
    header_en: 'Kalyan Hospital Patient Identity',
    header_hi: 'कल्याण हॉस्पिटल मरीज पहचान पत्र',
    footer_en: 'Present this card at each visit.',
    footer_hi: 'प्रत्येक परामर्श के समय यह कार्ड प्रस्तुत करें।',
    version: 1,
    updated_at: '2026-11-08T00:00:00Z',
  },
  {
    id: 4,
    document_type: 'consultation_summary',
    header_en: 'Kalyan Hospital Clinical Summary',
    header_hi: 'कल्याण हॉस्पिटल नैदानिक सारांश',
    footer_en: 'Consultation validity: 7 days.',
    footer_hi: 'परामर्श वैधता: 7 दिन।',
    version: 1,
    updated_at: '2026-11-08T00:00:00Z',
  },
]

let currentTemplates = [...mockTemplates]
const mutateUpdate = vi.fn().mockResolvedValue({})
const refetchFn = vi.fn()

vi.mock('../../api/queries', () => ({
  useMe: () => ({
    data: { full_name: 'Super Admin', role: 'ADMIN', username: 'admin' },
    isPending: false,
    isError: false,
  }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePrintTemplates: () => ({
    data: currentTemplates,
    isLoading: false,
    fetchError: null,
    refetch: refetchFn,
    isFetching: false,
  }),
  useUpdatePrintTemplate: () => ({
    mutateAsync: mutateUpdate,
    isPending: false,
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PrintTemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PrintTemplatesPage & PrintTemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentTemplates = [...mockTemplates]
    mutateUpdate.mockResolvedValue({})
  })

  it('renders all document tabs and default prescription template', () => {
    renderPage()

    // Document tabs
    expect(screen.getByRole('button', { name: /Prescription/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Receipt/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registration Card/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Consultation Summary/i })).toBeInTheDocument()

    // Version badge
    expect(screen.getByText('Version 1')).toBeInTheDocument()

    // Form inputs populated with prescription template
    const headerEnInput = screen.getByLabelText(/English Header Text/i) as HTMLTextAreaElement
    const headerHiInput = screen.getByLabelText(/Hindi Header Text/i) as HTMLTextAreaElement
    expect(headerEnInput.value).toBe('Kalyan Hospital Physiotherapy Department')
    expect(headerHiInput.value).toBe('कल्याण हॉस्पिटल फिजियोथेरेपी विभाग')

    // Live preview contains the header text
    expect(screen.getAllByText('Kalyan Hospital Physiotherapy Department').length).toBeGreaterThan(0)
    expect(screen.getAllByText('कल्याण हॉस्पिटल फिजियोथेरेपी विभाग').length).toBeGreaterThan(0)

    // Prescription Rx symbol in simulation
    expect(screen.getByText('℞')).toBeInTheDocument()
  })

  it('marks Hindi textareas with lang="hi"', () => {
    renderPage()

    const headerHiInput = screen.getByLabelText(/Hindi Header Text/i)
    const footerHiInput = screen.getByLabelText(/Hindi Footer Text/i)

    expect(headerHiInput).toHaveAttribute('lang', 'hi')
    expect(footerHiInput).toHaveAttribute('lang', 'hi')
  })

  it('switches tabs and updates form and preview', async () => {
    renderPage()

    // Switch to Receipt
    const receiptTab = screen.getByRole('button', { name: /Receipt/i })
    fireEvent.click(receiptTab)

    // Check version badge updated
    expect(screen.getByText('Version 2')).toBeInTheDocument()

    // Form updated to receipt values
    const headerEnInput = screen.getByLabelText(/English Header Text/i) as HTMLTextAreaElement
    expect(headerEnInput.value).toBe('Kalyan Hospital Accounts Department')

    // Receipt simulation elements visible
    expect(screen.getByText(/Receipt No: REC-2026-0089/i)).toBeInTheDocument()
    expect(screen.getByText(/Authorized Cashier/i)).toBeInTheDocument()
  })

  it('updates live simulation preview in real time when typing', () => {
    renderPage()

    const headerEnInput = screen.getByLabelText(/English Header Text/i)
    fireEvent.change(headerEnInput, { target: { value: 'Live Typed Clinic Header' } })

    // Both input and live simulation canvas render the typed text
    const matches = screen.getAllByText('Live Typed Clinic Header')
    expect(matches.length).toBe(2)
  })

  it('submits updated template data to mutation', async () => {
    renderPage()

    const headerEnInput = screen.getByLabelText(/English Header Text/i)
    fireEvent.change(headerEnInput, { target: { value: 'New Header Value' } })

    const saveBtn = screen.getByRole('button', { name: /Save Print Template/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mutateUpdate).toHaveBeenCalledWith({
        docType: 'prescription',
        payload: {
          header_en: 'New Header Value',
          header_hi: 'कल्याण हॉस्पिटल फिजियोथेरेपी विभाग',
          footer_en: 'Emergency 24x7: +91 6182 000000',
          footer_hi: 'आपातकालीन 24x7: +91 6182 000000',
          version: 1,
        },
      })
    })
  })

  it('displays ConflictBanner when mutation rejects with 409 conflict', async () => {
    mutateUpdate.mockRejectedValueOnce({
      status: 409,
      code: 'version_conflict',
      message: 'Record was modified by another user',
    })

    renderPage()

    const saveBtn = screen.getByRole('button', { name: /Save Print Template/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/Record was modified by another user/i)).toBeInTheDocument()
    })

    // Click Reload latest
    const reloadBtn = screen.getByRole('button', { name: /Reload latest/i })
    fireEvent.click(reloadBtn)
    expect(refetchFn).toHaveBeenCalled()
  })

  it('renders historical reprint snapshot callout notice', () => {
    renderPage()
    expect(screen.getByText(/Historical Reprint Snapshot Rule/i)).toBeInTheDocument()
    expect(
      screen.getByText(/When print templates are updated, changes apply immediately to newly issued documents/i),
    ).toBeInTheDocument()
  })
})
