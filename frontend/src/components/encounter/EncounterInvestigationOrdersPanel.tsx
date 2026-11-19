import { useState, type FormEvent } from 'react'
import { InlineAlert } from '../InlineAlert'
import { IconChevronDown, IconChevronRight, IconPlus } from '../icons'
import {
  useEncounterInvestigations,
  useCreateInvestigationOrder,
} from '../../api/queries'
import type { InvestigationCategory, InvestigationPriority } from '../../api/types'

const FIELD_LABEL = 'mb-1.5 block text-xs font-medium text-slate-700'
const TEXT_FIELD =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const INVESTIGATION_CATEGORIES: { value: InvestigationCategory; label: string }[] = [
  { value: 'LAB', label: 'Lab' },
  { value: 'IMAGING', label: 'Imaging' },
  { value: 'PATHOLOGY', label: 'Pathology' },
  { value: 'DIAGNOSTIC', label: 'Diagnostic' },
  { value: 'OTHER', label: 'Other' },
]

const INVESTIGATION_PRIORITIES: { value: InvestigationPriority; label: string }[] = [
  { value: 'ROUTINE', label: 'Routine' },
  { value: 'URGENT', label: 'Urgent' },
]

export interface EncounterInvestigationOrdersPanelProps {
  encounterId: number
  patientId: number
  isReadOnly: boolean
}

export function EncounterInvestigationOrdersPanel({
  encounterId,
  patientId,
  isReadOnly,
}: EncounterInvestigationOrdersPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [testName, setTestName] = useState('')
  const [category, setCategory] = useState<InvestigationCategory>('LAB')
  const [priority, setPriority] = useState<InvestigationPriority>('ROUTINE')
  const [instructions, setInstructions] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const ordersQuery = useEncounterInvestigations(encounterId, encounterId > 0)
  const createOrder = useCreateInvestigationOrder(encounterId, patientId || undefined)

  const orders = Array.isArray(ordersQuery.data) ? ordersQuery.data : []

  const handleOrderSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isReadOnly) return
    const trimmedTest = testName.trim()
    if (trimmedTest.length < 2) {
      setErrorMsg('Test or investigation name must be at least 2 characters.')
      return
    }
    setErrorMsg(null)
    try {
      await createOrder.mutateAsync({
        test_name: trimmedTest,
        category,
        priority,
        instructions: instructions.trim() || null,
      })
      setTestName('')
      setCategory('LAB')
      setPriority('ROUTINE')
      setInstructions('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create investigation order.')
    }
  }

  return (
    <div data-testid="encounter-investigations-panel">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900">
          {expanded ? (
            <IconChevronDown size={18} stroke={1.8} className="shrink-0" aria-hidden="true" />
          ) : (
            <IconChevronRight size={18} stroke={1.8} className="shrink-0" aria-hidden="true" />
          )}
          <span>Investigation Orders</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 tabular-nums">
            {orders.length}
          </span>
        </span>
        <span className="text-xs font-semibold text-[#8E1C3D]">
          {expanded ? 'Hide' : isReadOnly ? 'View' : 'Order / View'}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
          {errorMsg && (
            <InlineAlert tone="error" onDismiss={() => setErrorMsg(null)}>
              {errorMsg}
            </InlineAlert>
          )}

          {orders.length === 0 ? (
            <p className="text-xs leading-relaxed text-slate-600">
              No investigations ordered during this consultation yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/40">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="space-y-1 px-3.5 py-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{order.test_name}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-900">
                        {order.category}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${order.priority === 'URGENT'
                          ? 'border border-rose-300 bg-rose-100 text-rose-900'
                          : 'border border-slate-200 bg-white text-slate-700'
                          }`}
                      >
                        {order.priority}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-800">
                        {order.status}
                      </span>
                    </div>
                  </div>
                  {order.instructions && (
                    <p className="leading-relaxed text-slate-700">Instructions: {order.instructions}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!isReadOnly && (
            <form onSubmit={(e) => void handleOrderSubmit(e)} className="space-y-3 border-t border-slate-200 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor="enc-inv-test-name" className={FIELD_LABEL}>
                    Test / Investigation Name
                  </label>
                  <input
                    id="enc-inv-test-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={255}
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    placeholder="e.g. Complete Blood Count (CBC), MRI Lumbar Spine"
                    className={TEXT_FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="enc-inv-category" className={FIELD_LABEL}>
                    Category
                  </label>
                  <select
                    id="enc-inv-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as InvestigationCategory)}
                    className={TEXT_FIELD}
                  >
                    {INVESTIGATION_CATEGORIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="enc-inv-priority" className={FIELD_LABEL}>
                    Priority
                  </label>
                  <select
                    id="enc-inv-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as InvestigationPriority)}
                    className={TEXT_FIELD}
                  >
                    {INVESTIGATION_PRIORITIES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor="enc-inv-instructions" className={FIELD_LABEL}>
                    Instructions (optional)
                  </label>
                  <input
                    id="enc-inv-instructions"
                    type="text"
                    maxLength={1000}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. Fasting sample preferred, bring previous films"
                    className={TEXT_FIELD}
                  />
                </div>
                <button
                  type="submit"
                  disabled={createOrder.isPending}
                  className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#8E1C3D] px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-[#721631] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus size={14} stroke={1.8} className="shrink-0" aria-hidden="true" />
                  {createOrder.isPending ? 'Ordering…' : 'Order Investigation'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
