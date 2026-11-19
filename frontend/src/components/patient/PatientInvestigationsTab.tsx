import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, isVersionConflict } from '../../api/client'
import {
  downloadPatientDocumentBlob,
  usePatientDocuments,
  usePatientInvestigations,
  useRecordInvestigationResult,
  useUpdateInvestigationStatus,
} from '../../api/queries'
import type {
  InvestigationCategory,
  InvestigationOrderOut,
  InvestigationPriority,
  InvestigationStatus,
} from '../../api/types'
import { formatIst, withDoctorTitle } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'
import {
  IconAlertTriangle,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconReportMedical,
  IconX,
} from '../icons'

export interface PatientInvestigationsTabProps {
  patientId: number
  currentDoctorId?: number | null
  onOpenDocument?: (documentId: number) => void
}

interface ReportImagePreview {
  title: string
  filename: string
  url: string
}

const CATEGORY_META: Record<InvestigationCategory, { label: string; className: string }> = {
  LAB: {
    label: 'LAB',
    className: 'border border-sky-200 bg-sky-50 text-sky-900',
  },
  IMAGING: {
    label: 'IMAGING',
    className: 'border border-indigo-200 bg-indigo-50 text-indigo-900',
  },
  PATHOLOGY: {
    label: 'PATHOLOGY',
    className: 'border border-purple-200 bg-purple-50 text-purple-900',
  },
  DIAGNOSTIC: {
    label: 'DIAGNOSTIC',
    className: 'border border-teal-200 bg-teal-50 text-teal-900',
  },
  OTHER: {
    label: 'OTHER',
    className: 'border border-slate-200 bg-slate-100 text-slate-800',
  },
}

const PRIORITY_META: Record<InvestigationPriority, { label: string; className: string }> = {
  ROUTINE: {
    label: 'ROUTINE',
    className: 'border border-slate-200 bg-slate-100 text-slate-700',
  },
  URGENT: {
    label: 'URGENT',
    className: 'border border-rose-300 bg-rose-100 text-rose-900',
  },
}

const STATUS_META: Record<InvestigationStatus, { label: string; className: string }> = {
  ORDERED: {
    label: 'ORDERED',
    className: 'border border-amber-200 bg-amber-50 text-amber-900',
  },
  SAMPLE_COLLECTED: {
    label: 'SAMPLE COLLECTED',
    className: 'border border-sky-200 bg-sky-50 text-sky-900',
  },
  COMPLETED: {
    label: 'COMPLETED',
    className: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  CANCELLED: {
    label: 'CANCELLED',
    className: 'border border-rose-200 bg-rose-50 text-rose-900',
  },
}

const INPUT_CLASS =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-500 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-700'

interface ResultFormState {
  summaryText: string
  resultValue: string
  unit: string
  referenceRange: string
  isAbnormal: boolean
  documentId: string
}

const EMPTY_RESULT_FORM: ResultFormState = {
  summaryText: '',
  resultValue: '',
  unit: '',
  referenceRange: '',
  isAbnormal: false,
  documentId: '',
}

function getCategoryBadge(category: string) {
  return (
    CATEGORY_META[category as InvestigationCategory] ?? {
      label: category,
      className: 'border border-slate-200 bg-slate-100 text-slate-800',
    }
  )
}

function getPriorityBadge(priority: string) {
  return (
    PRIORITY_META[priority as InvestigationPriority] ?? {
      label: priority,
      className: 'border border-slate-200 bg-slate-100 text-slate-700',
    }
  )
}

function getStatusBadge(status: string) {
  return (
    STATUS_META[status as InvestigationStatus] ?? {
      label: status,
      className: 'border border-slate-200 bg-slate-100 text-slate-800',
    }
  )
}

function sortOrdersNewestFirst(orders: InvestigationOrderOut[]): InvestigationOrderOut[] {
  return [...orders].sort((a, b) => {
    const timeDiff = new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime()
    if (!Number.isNaN(timeDiff) && timeDiff !== 0) return timeDiff
    return b.id - a.id
  })
}

export function PatientInvestigationsTab({
  patientId,
  currentDoctorId,
  onOpenDocument,
}: PatientInvestigationsTabProps) {
  const { data, isPending, isError, error, refetch, isFetching } = usePatientInvestigations(
    patientId,
    true,
  )
  const updateStatus = useUpdateInvestigationStatus(patientId)
  const recordResult = useRecordInvestigationResult(patientId)

  const [advancingOrderId, setAdvancingOrderId] = useState<number | null>(null)

  const [resultOrder, setResultOrder] = useState<InvestigationOrderOut | null>(null)
  const [resultForm, setResultForm] = useState<ResultFormState>(EMPTY_RESULT_FORM)
  const [resultModalError, setResultModalError] = useState<string | null>(null)

  const [cancelOrder, setCancelOrder] = useState<InvestigationOrderOut | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelModalError, setCancelModalError] = useState<string | null>(null)

  const [loadingDocId, setLoadingDocId] = useState<number | null>(null)
  const [imagePreview, setImagePreview] = useState<ReportImagePreview | null>(null)
  const activePreviewUrlRef = useRef<string | null>(null)
  const tempBlobCleanupsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const { data: patientDocs } = usePatientDocuments(patientId, false, resultOrder !== null)
  const availableDocuments = Array.isArray(patientDocs) ? patientDocs : []

  useEffect(() => {
    const cleanups = tempBlobCleanupsRef.current
    return () => {
      if (activePreviewUrlRef.current) {
        URL.revokeObjectURL(activePreviewUrlRef.current)
        activePreviewUrlRef.current = null
      }
      for (const [url, timerId] of cleanups.entries()) {
        clearTimeout(timerId)
        URL.revokeObjectURL(url)
      }
      cleanups.clear()
    }
  }, [])

  const scheduleTempUrlRevoke = (url: string, delayMs: number) => {
    const timerId = setTimeout(() => {
      URL.revokeObjectURL(url)
      tempBlobCleanupsRef.current.delete(url)
    }, delayMs)
    tempBlobCleanupsRef.current.set(url, timerId)
  }

  const closeImagePreview = () => {
    if (activePreviewUrlRef.current) {
      URL.revokeObjectURL(activePreviewUrlRef.current)
      activePreviewUrlRef.current = null
    }
    setImagePreview(null)
  }

  const handleOpenReport = async (documentId: number, title: string) => {
    setLoadingDocId(documentId)
    try {
      const { url, filename, contentType } = await downloadPatientDocumentBlob(documentId)
      const mime = contentType.toLowerCase().split(';')[0].trim()
      if (mime === 'image/jpeg' || mime === 'image/png' || mime.startsWith('image/')) {
        if (activePreviewUrlRef.current) {
          URL.revokeObjectURL(activePreviewUrlRef.current)
        }
        activePreviewUrlRef.current = url
        setImagePreview({ title, filename, url })
        return
      }

      // CSP / X-Frame-Options: DENY safe: open PDFs in a new tab or fall back to download, never an <iframe>.
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened) {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.rel = 'noopener noreferrer'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        scheduleTempUrlRevoke(url, 1500)
      } else {
        scheduleTempUrlRevoke(url, 60_000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to open the linked report.')
    } finally {
      setLoadingDocId(null)
    }
  }

  const orders = sortOrdersNewestFirst(Array.isArray(data) ? data : [])

  const openResultModal = (order: InvestigationOrderOut) => {
    setResultOrder(order)
    setResultForm(EMPTY_RESULT_FORM)
    setResultModalError(null)
  }

  const closeResultModal = () => {
    if (recordResult.isPending) return
    setResultOrder(null)
    setResultForm(EMPTY_RESULT_FORM)
    setResultModalError(null)
  }

  const openCancelModal = (order: InvestigationOrderOut) => {
    setCancelOrder(order)
    setCancelReason('')
    setCancelModalError(null)
  }

  const closeCancelModal = () => {
    if (updateStatus.isPending) return
    setCancelOrder(null)
    setCancelReason('')
    setCancelModalError(null)
  }

  const handleMarkSampleCollected = async (order: InvestigationOrderOut) => {
    setAdvancingOrderId(order.id)

    try {
      await updateStatus.mutateAsync({
        orderId: order.id,
        body: {
          status: 'SAMPLE_COLLECTED',
          version_id: order.version_id,
        },
      })
      toast.success(`Marked "${order.test_name}" as sample collected.`)
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        toast.error(
          `The order for "${order.test_name}" changed elsewhere. Reload the latest investigations and try again.`,
          {
            action: {
              label: 'Reload latest',
              onClick: () => {
                void refetch()
              },
            },
          },
        )
      } else {
        toast.error(err instanceof Error ? err.message : 'Unable to update investigation status.')
      }
    } finally {
      setAdvancingOrderId(null)
    }
  }

  const handleSubmitResult = async (e: FormEvent) => {
    e.preventDefault()
    if (!resultOrder) return

    const summaryText = resultForm.summaryText.trim()
    if (!summaryText) {
      setResultModalError('Result summary is required.')
      return
    }

    setResultModalError(null)

    try {
      const parsedDocId = resultForm.documentId ? Number(resultForm.documentId) : null
      await recordResult.mutateAsync({
        orderId: resultOrder.id,
        body: {
          summary_text: summaryText,
          result_value: resultForm.resultValue.trim() || null,
          unit: resultForm.unit.trim() || null,
          reference_range: resultForm.referenceRange.trim() || null,
          is_abnormal: resultForm.isAbnormal,
          ...(parsedDocId !== null && Number.isFinite(parsedDocId) && parsedDocId > 0
            ? { document_id: parsedDocId }
            : {}),
        },
      })
      toast.success(`Recorded result for "${resultOrder.test_name}".`)
      setResultOrder(null)
      setResultForm(EMPTY_RESULT_FORM)
    } catch (err) {
      setResultModalError(
        err instanceof Error ? err.message : 'Unable to record investigation result.',
      )
    }
  }

  const handleSubmitCancel = async (e: FormEvent) => {
    e.preventDefault()
    if (!cancelOrder) return

    const trimmedReason = cancelReason.trim()
    if (trimmedReason.length < 3) {
      setCancelModalError('Cancellation reason must be at least 3 characters.')
      return
    }

    setCancelModalError(null)

    try {
      await updateStatus.mutateAsync({
        orderId: cancelOrder.id,
        body: {
          status: 'CANCELLED',
          cancelled_reason: trimmedReason,
          version_id: cancelOrder.version_id,
        },
      })
      toast.success(`Cancelled investigation order "${cancelOrder.test_name}".`)
      setCancelOrder(null)
      setCancelReason('')
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        setCancelModalError(
          'This investigation order was updated elsewhere. Reload the latest list before cancelling.',
        )
      } else {
        setCancelModalError(
          err instanceof Error ? err.message : 'Unable to cancel investigation order.',
        )
      }
    }
  }

  return (
    <section aria-labelledby="patient-investigations-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="patient-investigations-heading" className="text-base font-bold text-slate-900">
            Investigations &amp; Results
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {orders.length > 0
              ? `${orders.length} investigation ${orders.length === 1 ? 'order' : 'orders'} recorded`
              : 'Ordered laboratory, imaging, pathology, and diagnostic investigations'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh investigations"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
        >
          <IconRefresh size={16} stroke={1.8} aria-hidden="true" />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isPending ? (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600"
        >
          Loading investigation orders…
        </div>
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load investigations{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Retry loading investigations"
              className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            No investigation orders recorded for this patient yet.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Orders placed during clinical consultations will appear here with their results.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const category = getCategoryBadge(order.category)
            const priority = getPriorityBadge(order.priority)
            const status = getStatusBadge(order.status)
            const isOwnOrder = Boolean(currentDoctorId && order.doctor_id === currentDoctorId)
            const canMarkSampleCollected = isOwnOrder && order.status === 'ORDERED'
            const canRecordResult = isOwnOrder && order.status !== 'CANCELLED'
            const canCancelOrder =
              isOwnOrder &&
              (order.status === 'ORDERED' || order.status === 'SAMPLE_COLLECTED')
            const results = order.results

            return (
              <article
                key={order.id}
                aria-label={`Investigation ${order.test_name}`}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">{order.test_name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${category.className}`}
                      >
                        {category.label}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priority.className}`}
                      >
                        {priority.label}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                      <Link
                        to={`/doctor/encounters/${order.encounter_id}`}
                        className="rounded bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-800 hover:bg-rose-50 hover:text-[#8E1C3D]"
                      >
                        {order.encounter_code}
                      </Link>
                      <span>Ordered {formatIst(order.ordered_at)}</span>
                      {order.doctor_name && (
                        <span className="font-medium text-slate-700">
                          {withDoctorTitle(order.doctor_name)}
                        </span>
                      )}
                    </div>
                  </div>

                  {(canMarkSampleCollected || canRecordResult || canCancelOrder) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canMarkSampleCollected && (
                        <button
                          type="button"
                          disabled={advancingOrderId === order.id}
                          onClick={() => void handleMarkSampleCollected(order)}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                        >
                          <IconCheck size={15} stroke={1.8} aria-hidden="true" />
                          {advancingOrderId === order.id
                            ? 'Updating…'
                            : 'Mark Sample Collected'}
                        </button>
                      )}

                      {canRecordResult && (
                        <button
                          type="button"
                          onClick={() => openResultModal(order)}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#5D0B26] px-3 text-xs font-semibold text-white hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                        >
                          <IconPlus size={15} stroke={1.8} aria-hidden="true" />
                          Record Result
                        </button>
                      )}

                      {canCancelOrder && (
                        <button
                          type="button"
                          onClick={() => openCancelModal(order)}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                        >
                          <IconX size={15} stroke={1.8} aria-hidden="true" />
                          Cancel Order
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {order.instructions && (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Instructions:</span>{' '}
                    {order.instructions}
                  </p>
                )}

                {order.status === 'CANCELLED' && order.cancelled_reason && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-900">
                    <span className="font-semibold">Cancellation Reason:</span>{' '}
                    {order.cancelled_reason}
                  </p>
                )}

                {/* Results list */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Recorded Results ({results.length})
                  </h4>

                  {results.length === 0 ? (
                    <p className="text-xs text-slate-600">No results recorded yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {results.map((result) => {
                        const documentId =
                          typeof result.document_id === 'number' && result.document_id > 0
                            ? result.document_id
                            : null
                        const formattedValue = [result.result_value, result.unit]
                          .filter((part): part is string => Boolean(part && part.trim()))
                          .join(' ')

                        return (
                          <div
                            key={result.id}
                            className={`rounded-lg border p-3.5 space-y-2 ${
                              result.is_abnormal
                                ? 'border-rose-200 bg-rose-50/40'
                                : 'border-slate-200 bg-slate-50/50'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {formattedValue && (
                                  <span className="font-mono text-sm font-bold text-slate-900">
                                    {formattedValue}
                                  </span>
                                )}
                                {result.reference_range && (
                                  <span className="text-xs text-slate-600">
                                    Ref: {result.reference_range}
                                  </span>
                                )}
                                {result.is_abnormal && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-900">
                                    <IconAlertTriangle
                                      size={13}
                                      stroke={2}
                                      aria-hidden="true"
                                    />
                                    Abnormal
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span>Reported {formatIst(result.reported_at)}</span>
                                {result.recorded_by_username && (
                                  <span>· by {result.recorded_by_username}</span>
                                )}
                                {documentId !== null && (
                                  <button
                                    type="button"
                                    disabled={loadingDocId === documentId}
                                    onClick={() => {
                                      if (onOpenDocument) {
                                        onOpenDocument(documentId)
                                      } else {
                                        void handleOpenReport(
                                          documentId,
                                          result.document_title || `${order.test_name} Report`,
                                        )
                                      }
                                    }}
                                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-[#8E1C3D] hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                                  >
                                    <IconReportMedical
                                      size={14}
                                      stroke={1.8}
                                      aria-hidden="true"
                                    />
                                    {loadingDocId === documentId
                                      ? 'Opening…'
                                      : result.document_title
                                        ? `View Report (${result.document_title})`
                                        : 'View Report'}
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="whitespace-pre-wrap text-sm text-slate-800">
                              {result.summary_text}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Record Result Modal */}
      <Modal
        open={resultOrder !== null}
        onClose={closeResultModal}
        title="Record Investigation Result"
        description={
          resultOrder ? `${resultOrder.test_name} (${resultOrder.encounter_code})` : undefined
        }
        variant="info"
        busy={recordResult.isPending}
        className="max-w-lg"
      >
        <form onSubmit={(e) => void handleSubmitResult(e)} className="space-y-4">
          {resultModalError && (
            <InlineAlert tone="error" onDismiss={() => setResultModalError(null)}>
              {resultModalError}
            </InlineAlert>
          )}

          <div>
            <label htmlFor="inv-result-summary" className={LABEL_CLASS}>
              Result Summary / Findings *
            </label>
            <textarea
              id="inv-result-summary"
              data-autofocus
              required
              rows={4}
              maxLength={10000}
              value={resultForm.summaryText}
              onChange={(e) =>
                setResultForm((prev) => ({ ...prev, summaryText: e.target.value }))
              }
              placeholder="Enter key findings, impression, or laboratory interpretation…"
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-result-value" className={LABEL_CLASS}>
                Measured Value
              </label>
              <input
                id="inv-result-value"
                type="text"
                maxLength={120}
                value={resultForm.resultValue}
                onChange={(e) =>
                  setResultForm((prev) => ({ ...prev, resultValue: e.target.value }))
                }
                placeholder="e.g. 13.4"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="inv-result-unit" className={LABEL_CLASS}>
                Unit
              </label>
              <input
                id="inv-result-unit"
                type="text"
                maxLength={40}
                value={resultForm.unit}
                onChange={(e) => setResultForm((prev) => ({ ...prev, unit: e.target.value }))}
                placeholder="e.g. g/dL"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-result-reference-range" className={LABEL_CLASS}>
              Reference Range
            </label>
            <input
              id="inv-result-reference-range"
              type="text"
              maxLength={120}
              value={resultForm.referenceRange}
              onChange={(e) =>
                setResultForm((prev) => ({ ...prev, referenceRange: e.target.value }))
              }
              placeholder="e.g. 12.0 – 15.5 g/dL"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="inv-result-document" className={LABEL_CLASS}>
              Linked Report Document (optional)
            </label>
            <select
              id="inv-result-document"
              value={resultForm.documentId}
              onChange={(e) =>
                setResultForm((prev) => ({ ...prev, documentId: e.target.value }))
              }
              className={INPUT_CLASS}
            >
              <option value="">None (no attached report)</option>
              {availableDocuments.map((doc) => (
                <option key={doc.id} value={String(doc.id)}>
                  {doc.title} ({doc.original_filename})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800 cursor-pointer">
            <input
              id="inv-result-abnormal"
              type="checkbox"
              checked={resultForm.isAbnormal}
              onChange={(e) =>
                setResultForm((prev) => ({ ...prev, isAbnormal: e.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
            />
            <span>Flag as abnormal result</span>
          </label>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={recordResult.isPending}
              onClick={closeResultModal}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={recordResult.isPending}
              className="inline-flex min-h-11 items-center rounded-lg bg-[#5D0B26] px-4 text-sm font-semibold text-white hover:bg-[#7A1235] disabled:opacity-50 cursor-pointer"
            >
              {recordResult.isPending ? 'Saving Result…' : 'Save Result'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Cancel Order Modal */}
      <Modal
        open={cancelOrder !== null}
        onClose={closeCancelModal}
        title="Cancel Investigation Order"
        description={
          cancelOrder ? `${cancelOrder.test_name} (${cancelOrder.encounter_code})` : undefined
        }
        variant="destructive"
        busy={updateStatus.isPending}
        className="max-w-md"
      >
        <form onSubmit={(e) => void handleSubmitCancel(e)} className="space-y-4">
          {cancelModalError && (
            <InlineAlert tone="error" onDismiss={() => setCancelModalError(null)}>
              {cancelModalError}
            </InlineAlert>
          )}

          <p className="text-xs text-slate-600">
            Provide the clinical or operational reason for cancelling this investigation order.
          </p>

          <div>
            <label htmlFor="inv-cancel-reason" className={LABEL_CLASS}>
              Cancellation Reason *
            </label>
            <textarea
              id="inv-cancel-reason"
              data-autofocus
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Duplicate order, patient already brought recent lab report…"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={updateStatus.isPending}
              onClick={closeCancelModal}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={updateStatus.isPending}
              className="inline-flex min-h-11 items-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50 cursor-pointer"
            >
              {updateStatus.isPending ? 'Cancelling…' : 'Confirm Cancel'}
            </button>
          </div>
        </form>
      </Modal>

      {/* CSP-safe Image Report Preview Modal (zero <iframe>) */}
      <Modal
        open={imagePreview !== null}
        onClose={closeImagePreview}
        title={imagePreview?.title ?? 'Report Preview'}
        description={imagePreview?.filename}
        variant="info"
        dismiss="any"
        className="max-w-3xl"
      >
        {imagePreview && (
          <div className="space-y-4">
            <div className="flex justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
              <img
                src={imagePreview.url}
                alt={imagePreview.title}
                className="max-h-[65vh] w-auto max-w-full rounded object-contain"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <a
                href={imagePreview.url}
                download={imagePreview.filename}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Download Image
              </a>
              <button
                type="button"
                onClick={closeImagePreview}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-slate-800 px-3.5 text-xs font-semibold text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
