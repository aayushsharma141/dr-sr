import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickPhraseBar } from '../QuickPhraseBar'
import type { QuickPhraseListResponse, QuickPhraseOut, QuickPhraseSection } from '../../api/types'

function makePhrase(overrides: Partial<QuickPhraseOut> & { id: number; phrase_text: string }): QuickPhraseOut {
  return {
    scope: 'HOSPITAL_DEFAULT',
    doctor_id: null,
    department_id: null,
    department_code: 'PHYSIOTHERAPY',
    section: 'COMPLAINTS',
    sort_order: 0,
    is_active: true,
    created_at: '2026-11-18T10:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
    ...overrides,
  }
}

function jsonResponse(status: number, body?: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  })
}

describe('QuickPhraseBar', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderWithClient(ui: React.ReactElement) {
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  }

  it('visually separates Hospital Defaults from My Phrases and appends multiple clicks without overwriting existing text', async () => {
    const user = userEvent.setup()
    const payload: QuickPhraseListResponse = {
      defaults: [
        makePhrase({ id: 1, phrase_text: 'Low back pain radiating to leg' }),
        makePhrase({ id: 2, phrase_text: 'Cervical stiffness & neck pain' }),
      ],
      personal: [
        makePhrase({
          id: 101,
          scope: 'PERSONAL',
          doctor_id: 7,
          department_id: 1,
          phrase_text: 'Lumbar paraspinal spasm',
        }),
      ],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => jsonResponse(200, payload)),
    )

    function Harness() {
      const [text, setText] = useState('Morning stiffness')
      const append = (phrase: string) => {
        setText((prev) => {
          const trimmed = prev.trim()
          if (!trimmed) return phrase
          return trimmed.endsWith(',') || trimmed.endsWith('.')
            ? `${trimmed} ${phrase}`
            : `${trimmed}, ${phrase}`
        })
      }
      return (
        <div>
          <QuickPhraseBar departmentId={1} section="COMPLAINTS" onSelectPhrase={append} />
          <textarea aria-label="Symptoms" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )
    }

    renderWithClient(<Harness />)

    const defaultsGroup = await screen.findByTestId('quick-phrases-defaults')
    const personalGroup = await screen.findByTestId('quick-phrases-personal')

    expect(within(defaultsGroup).getByText('Hospital Defaults')).toBeInTheDocument()
    expect(within(personalGroup).getByText('My Phrases')).toBeInTheDocument()

    // Hospital Defaults are read-only (no edit/delete buttons)
    expect(within(defaultsGroup).queryByRole('button', { name: /Edit quick phrase/i })).not.toBeInTheDocument()
    expect(within(defaultsGroup).queryByRole('button', { name: /Delete quick phrase/i })).not.toBeInTheDocument()

    // My Phrases have edit & delete buttons
    expect(within(personalGroup).getByRole('button', { name: /Edit quick phrase: Lumbar paraspinal spasm/i })).toBeInTheDocument()
    expect(within(personalGroup).getByRole('button', { name: /Delete quick phrase: Lumbar paraspinal spasm/i })).toBeInTheDocument()

    // Multi-click append preserves existing text
    await user.click(within(defaultsGroup).getByRole('button', { name: /\+ Low back pain radiating to leg/i }))
    await user.click(within(personalGroup).getByRole('button', { name: /\+ Lumbar paraspinal spasm/i }))

    const textarea = screen.getByLabelText('Symptoms') as HTMLTextAreaElement
    expect(textarea.value).toBe('Morning stiffness, Low back pain radiating to leg, Lumbar paraspinal spasm')
  })

  it('supports adding, editing, and manually deleting personal phrases with validation, duplicate error handling, and delete confirmation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    let nextId = 200
    let personalPhrases: QuickPhraseOut[] = [
      makePhrase({
        id: 101,
        scope: 'PERSONAL',
        doctor_id: 7,
        department_id: 1,
        phrase_text: 'SLR positive 45 deg',
      }),
    ]
    const defaultPhrases: QuickPhraseOut[] = [
      makePhrase({ id: 1, phrase_text: 'Low back pain radiating to leg' }),
    ]

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url)
      const method = (init?.method || 'GET').toUpperCase()

      if (u.startsWith('/api/quick-phrases') && method === 'GET') {
        return jsonResponse(200, { defaults: defaultPhrases, personal: personalPhrases })
      }
      if (u === '/api/quick-phrases' && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        const dup = personalPhrases.find(
          (p) => p.phrase_text.toLowerCase() === String(body.phrase_text).toLowerCase(),
        )
        if (dup) {
          return jsonResponse(409, {
            code: 'duplicate_phrase',
            message: 'This quick phrase already exists in this section.',
          })
        }
        const created = makePhrase({
          id: nextId++,
          scope: 'PERSONAL',
          doctor_id: 7,
          department_id: body.department_id ?? null,
          section: body.section ?? 'COMPLAINTS',
          phrase_text: body.phrase_text,
        })
        personalPhrases = [...personalPhrases, created]
        return jsonResponse(201, created)
      }
      if (/\/api\/quick-phrases\/\d+$/.test(u) && method === 'PATCH') {
        const id = Number(u.split('/').pop())
        const body = JSON.parse(String(init?.body))
        const updated = personalPhrases.find((p) => p.id === id)
        if (!updated) return jsonResponse(404, { code: 'quick_phrase_not_found', message: 'Not found' })
        const next = { ...updated, phrase_text: body.phrase_text }
        personalPhrases = personalPhrases.map((p) => (p.id === id ? next : p))
        return jsonResponse(200, next)
      }
      if (/\/api\/quick-phrases\/\d+$/.test(u) && method === 'DELETE') {
        const id = Number(u.split('/').pop())
        personalPhrases = personalPhrases.filter((p) => p.id !== id)
        return jsonResponse(204)
      }
      return jsonResponse(404, { code: 'not_found', message: 'Unknown route' })
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithClient(<QuickPhraseBar departmentId={1} section="COMPLAINTS" onSelectPhrase={onSelect} />)
    await screen.findByText(/\+ SLR positive 45 deg/i)

    // 1. Add validation (< 2 chars)
    await user.click(screen.getByRole('button', { name: /Add Custom Phrase/i }))
    const addInput = screen.getByLabelText('New quick phrase text')
    await user.type(addInput, 'a')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 2 characters/i)

    // 2. Add duplicate shows inline 409 error cleanly
    await user.clear(addInput)
    await user.type(addInput, 'SLR positive 45 deg')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists in this section/i)

    // 3. Add valid phrase -> persists & appends on save
    await user.clear(addInput)
    await user.type(addInput, 'Plantar heel tenderness')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('Plantar heel tenderness')
    })
    expect(await screen.findByText(/\+ Plantar heel tenderness/i)).toBeInTheDocument()

    // 4. Inline edit personal phrase
    await user.click(screen.getByRole('button', { name: /Edit quick phrase: Plantar heel tenderness/i }))
    const editInput = screen.getByLabelText('Edit quick phrase text')
    await user.clear(editInput)
    await user.type(editInput, 'Medial heel tenderness')
    await user.click(screen.getByRole('button', { name: /Save edited phrase/i }))
    expect(await screen.findByText(/\+ Medial heel tenderness/i)).toBeInTheDocument()
    expect(screen.queryByText(/\+ Plantar heel tenderness/i)).not.toBeInTheDocument()

    // 5. Manual delete requires confirmation — first click does NOT call DELETE
    await user.click(screen.getByRole('button', { name: /Delete quick phrase: Medial heel tenderness/i }))
    expect(screen.getByTestId('confirm-delete-phrase-200')).toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

    // Cancel aborts delete
    await user.click(screen.getByRole('button', { name: /Cancel delete quick phrase/i }))
    expect(screen.queryByTestId('confirm-delete-phrase-200')).not.toBeInTheDocument()
    expect(screen.getByText(/\+ Medial heel tenderness/i)).toBeInTheDocument()

    // Confirm executes DELETE and removes phrase
    await user.click(screen.getByRole('button', { name: /Delete quick phrase: Medial heel tenderness/i }))
    await user.click(screen.getByRole('button', { name: /Confirm delete quick phrase: Medial heel tenderness/i }))

    await waitFor(() => {
      expect(screen.queryByText(/\+ Medial heel tenderness/i)).not.toBeInTheDocument()
    })
    expect(mockFetch.mock.calls.some(([u, init]) => String(u) === '/api/quick-phrases/200' && init?.method === 'DELETE')).toBe(true)
  })

  it('switches departments cleanly without leaking prior department phrases', async () => {
    const deptData: Record<string, QuickPhraseListResponse> = {
      '1': {
        defaults: [makePhrase({ id: 1, department_code: 'PHYSIOTHERAPY', phrase_text: 'Low back pain radiating to leg' })],
        personal: [
          makePhrase({
            id: 11,
            scope: 'PERSONAL',
            doctor_id: 7,
            department_id: 1,
            department_code: 'PHYSIOTHERAPY',
            phrase_text: 'My Physio Phrase',
          }),
        ],
      },
      '2': {
        defaults: [makePhrase({ id: 2, department_code: 'OPHTHALMOLOGY', phrase_text: 'Blurry vision for distance & near' })],
        personal: [
          makePhrase({
            id: 22,
            scope: 'PERSONAL',
            doctor_id: 7,
            department_id: 2,
            department_code: 'OPHTHALMOLOGY',
            phrase_text: 'My Ophth Phrase',
          }),
        ],
      },
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const parsed = new URL(String(url), 'http://localhost')
      const deptId = parsed.searchParams.get('department_id') || ''
      return jsonResponse(200, deptData[deptId] ?? { defaults: [], personal: [] })
    })
    vi.stubGlobal('fetch', mockFetch)

    const { rerender } = renderWithClient(
      <QuickPhraseBar departmentId={1} section="COMPLAINTS" onSelectPhrase={vi.fn()} />,
    )

    expect(await screen.findByText(/\+ Low back pain radiating to leg/i)).toBeInTheDocument()
    expect(screen.getByText(/\+ My Physio Phrase/i)).toBeInTheDocument()

    // Switch department 1 -> 2
    rerender(
      <QueryClientProvider client={queryClient}>
        <QuickPhraseBar departmentId={2} section="COMPLAINTS" onSelectPhrase={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/\+ Blurry vision for distance & near/i)).toBeInTheDocument()
    expect(screen.getByText(/\+ My Ophth Phrase/i)).toBeInTheDocument()
    expect(screen.queryByText(/Low back pain radiating to leg/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/My Physio Phrase/i)).not.toBeInTheDocument()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/quick-phrases?section=COMPLAINTS&department_id=2',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('shows compact search filter only when total phrases exceed 8 and filters defaults & personal phrases', async () => {
    const user = userEvent.setup()
    const manyDefaults = Array.from({ length: 7 }, (_, i) =>
      makePhrase({ id: i + 1, phrase_text: `Default symptom ${i + 1}` }),
    )
    const manyPersonal = [
      makePhrase({ id: 51, scope: 'PERSONAL', doctor_id: 7, department_id: 1, phrase_text: 'Sciatic tenderness' }),
      makePhrase({ id: 52, scope: 'PERSONAL', doctor_id: 7, department_id: 1, phrase_text: 'Rotator cuff pain' }),
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => jsonResponse(200, { defaults: manyDefaults, personal: manyPersonal })),
    )

    renderWithClient(<QuickPhraseBar departmentId={1} section="COMPLAINTS" onSelectPhrase={vi.fn()} />)
    const filterInput = await screen.findByLabelText('Filter quick phrases')

    await user.type(filterInput, 'sciatic')
    expect(screen.getByText(/\+ Sciatic tenderness/i)).toBeInTheDocument()
    expect(screen.queryByText(/\+ Rotator cuff pain/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\+ Default symptom 1/i)).not.toBeInTheDocument()
  })

  it('renders inline error notice with Retry button on fetch failure and recovers on retry', async () => {
    const user = userEvent.setup()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        calls += 1
        if (calls === 1) {
          return jsonResponse(503, { code: 'service_unavailable', message: 'LAN database busy' })
        }
        return jsonResponse(200, {
          defaults: [makePhrase({ id: 1, phrase_text: 'Recovered phrase' })],
          personal: [],
        })
      }),
    )

    renderWithClient(<QuickPhraseBar departmentId={1} section={'COMPLAINTS' as QuickPhraseSection} onSelectPhrase={vi.fn()} />)

    const errBox = await screen.findByTestId('quick-phrases-error')
    expect(errBox).toHaveTextContent(/LAN database busy/i)

    await user.click(within(errBox).getByRole('button', { name: /Retry/i }))
    expect(await screen.findByText(/\+ Recovered phrase/i)).toBeInTheDocument()
    expect(screen.queryByTestId('quick-phrases-error')).not.toBeInTheDocument()
  })

  it('never touches localStorage during load, add, edit, delete, or department switch', async () => {
    const user = userEvent.setup()
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const clearSpy = vi.spyOn(Storage.prototype, 'clear')

    let personal: QuickPhraseOut[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const method = (init?.method || 'GET').toUpperCase()
        if (method === 'GET') {
          return jsonResponse(200, {
            defaults: [makePhrase({ id: 1, phrase_text: 'Default item' })],
            personal,
          })
        }
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body))
          const created = makePhrase({
            id: 301,
            scope: 'PERSONAL',
            doctor_id: 7,
            department_id: body.department_id,
            phrase_text: body.phrase_text,
          })
          personal = [created]
          return jsonResponse(201, created)
        }
        if (method === 'DELETE' && String(url).endsWith('/301')) {
          personal = []
          return jsonResponse(204)
        }
        return jsonResponse(200, {})
      }),
    )

    const { rerender } = renderWithClient(
      <QuickPhraseBar departmentId={1} section="COMPLAINTS" onSelectPhrase={vi.fn()} />,
    )
    await screen.findByText(/\+ Default item/i)

    await user.click(screen.getByRole('button', { name: /Add Custom Phrase/i }))
    await user.type(screen.getByLabelText('New quick phrase text'), 'Zero storage phrase')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))
    await screen.findByText(/\+ Zero storage phrase/i)

    await user.click(screen.getByRole('button', { name: /Delete quick phrase: Zero storage phrase/i }))
    await user.click(screen.getByRole('button', { name: /Confirm delete quick phrase: Zero storage phrase/i }))
    await waitFor(() => {
      expect(screen.queryByText(/\+ Zero storage phrase/i)).not.toBeInTheDocument()
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <QuickPhraseBar departmentId={2} section="EXAMINATION" onSelectPhrase={vi.fn()} />
      </QueryClientProvider>,
    )
    await screen.findByText(/\+ Default item/i)

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
    expect(clearSpy).not.toHaveBeenCalled()
  })
})
