import { useState, type FormEvent, type ReactNode } from 'react'
import { useClinicSettings, useUpdateClinicSettings, useMe } from '../api/queries'
import { ApiError } from '../api/client'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { UnsavedChangesGuard } from '../components/UnsavedChangesGuard'
import type { ClinicSettingsOut, ClinicSettingsUpdate, ReceiptCycleConfirmationExtra } from '../api/types'

type ReceiptCycle = ClinicSettingsOut['receipt_sequence_cycle']

/** Form values keyed by the API field names, so 422 field errors map straight onto inputs. */
interface SettingsForm {
  name_en: string
  name_hi: string
  address_1: string
  address_2: string
  phone: string
  email: string
  receipt_sequence_cycle: ReceiptCycle
  print_header_en: string
  print_header_hi: string
  print_footer_en: string
  print_footer_hi: string
  consultation_validity_days: string
}

type FieldName = keyof SettingsForm
type FieldErrors = Partial<Record<FieldName, string>>

const FIELD_NAMES: readonly FieldName[] = [
  'name_en',
  'name_hi',
  'address_1',
  'address_2',
  'phone',
  'email',
  'receipt_sequence_cycle',
  'print_header_en',
  'print_header_hi',
  'print_footer_en',
  'print_footer_hi',
  'consultation_validity_days',
]

const CHANGE_REASON_MAX_LENGTH = 500

const CYCLE_LABEL: Record<ReceiptCycle, string> = {
  FINANCIAL_YEAR: 'Financial year (April–March)',
  CALENDAR_YEAR: 'Calendar year (January–December)',
}

function toForm(s: ClinicSettingsOut): SettingsForm {
  return {
    name_en: s.name_en,
    name_hi: s.name_hi,
    address_1: s.address_1,
    address_2: s.address_2 ?? '',
    phone: s.phone,
    email: s.email ?? '',
    receipt_sequence_cycle: s.receipt_sequence_cycle,
    print_header_en: s.print_header_en ?? '',
    print_header_hi: s.print_header_hi ?? '',
    print_footer_en: s.print_footer_en ?? '',
    print_footer_hi: s.print_footer_hi ?? '',
    consultation_validity_days: String(s.consultation_validity_days),
  }
}

function formsEqual(a: SettingsForm, b: SettingsForm): boolean {
  return FIELD_NAMES.every((k) => a[k] === b[k])
}

/** Today's year and month on the India (IST) business date, as the server evaluates cycles. */
function istYearMonth(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return { year, month }
}

/** Mirrors receipt_service.get_cycle_key: CALENDAR_YEAR -> "2026", FINANCIAL_YEAR -> "2026-2027". */
function cycleKeyForToday(cycle: ReceiptCycle): string {
  const { year, month } = istYearMonth()
  if (cycle === 'CALENDAR_YEAR') return String(year)
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

/** Mirrors receipt_service.allocate_next_receipt_number: RCP-{cycle_key}-{NNNN}. */
function exampleReceiptNumber(cycle: ReceiptCycle): string {
  return `RCP-${cycleKeyForToday(cycle)}-0001`
}

function isReceiptCycle(value: unknown): value is ReceiptCycle {
  return value === 'FINANCIAL_YEAR' || value === 'CALENDAR_YEAR'
}

function cycleLabel(value: unknown): string {
  return isReceiptCycle(value) ? CYCLE_LABEL[value] : String(value)
}

function readCycleExtra(err: ApiError): ReceiptCycleConfirmationExtra {
  const x = err.extra
  return {
    current_cycle: typeof x.current_cycle === 'string' ? x.current_cycle : '',
    current_cycle_key: typeof x.current_cycle_key === 'string' ? x.current_cycle_key : '',
    requested_cycle: typeof x.requested_cycle === 'string' ? x.requested_cycle : '',
    receipts_issued: typeof x.receipts_issued === 'number' ? x.receipts_issued : 0,
  }
}

/**
 * Splits a 422 validation_error envelope ({fields: [{loc, message}]}) into messages for the
 * form fields it names and general messages (model-level errors such as change_reason).
 */
function readValidationErrors(err: ApiError): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {}
  const general: string[] = []
  const raw = err.extra.fields
  if (!Array.isArray(raw)) return { fields, general }
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const loc = Array.isArray(rec.loc) ? rec.loc.map(String) : []
    const message = (typeof rec.message === 'string' ? rec.message : 'Invalid value').replace(/^Value error, /, '')
    const name = loc[loc.length - 1]
    if (name && (FIELD_NAMES as readonly string[]).includes(name)) {
      const key = name as FieldName
      fields[key] = fields[key] ? `${fields[key]} ${message}` : message
    } else {
      general.push(message)
    }
  }
  return { fields, general }
}

const INPUT_CLASS =
  'w-full px-3 py-2 border rounded min-h-11 text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'

interface FieldProps {
  id: string
  label: ReactNode
  error?: string
  hint?: ReactNode
  className?: string
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode
}

function Field({ id, label, error, hint, className = '', children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800 mb-1">
        {label}
      </label>
      {children(describedBy, Boolean(error))}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-neutral-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}

function inputBorder(invalid: boolean): string {
  return invalid ? 'border-red-700' : 'border-neutral-300'
}

interface SectionProps {
  id: string
  title: string
  description: ReactNode
  children: ReactNode
}

function Section({ id, title, description, children }: SectionProps) {
  return (
    <section aria-labelledby={id} className="bg-white rounded-lg border border-neutral-200 shadow-xs">
      <header className="border-b border-neutral-200 px-6 py-4">
        <h3 id={id} className="text-lg font-semibold text-[#5D0B26]">
          {title}
        </h3>
        <p className="text-sm text-neutral-600">{description}</p>
      </header>
      <div className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-2">{children}</div>
    </section>
  )
}

interface PendingCycleChange {
  payload: ClinicSettingsUpdate
  extra: ReceiptCycleConfirmationExtra
}

export function Settings() {
  const { data: me } = useMe()
  const { data: settings, isPending, isError, error, refetch } = useClinicSettings()
  const updateMutation = useUpdateClinicSettings()

  const [form, setForm] = useState<SettingsForm | null>(null)
  const [baseline, setBaseline] = useState<SettingsForm | null>(null)
  const [appliedVersion, setAppliedVersion] = useState<number | null>(null)

  const [isConflict, setIsConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMessages, setErrorMessages] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [pendingCycleChange, setPendingCycleChange] = useState<PendingCycleChange | null>(null)
  const [changeReason, setChangeReason] = useState('')
  const [cycleModalError, setCycleModalError] = useState<string | null>(null)

  const dirty = form !== null && baseline !== null && !formsEqual(form, baseline)

  const applyServer = (s: ClinicSettingsOut) => {
    const next = toForm(s)
    setForm(next)
    setBaseline(next)
    setAppliedVersion(s.version_id)
  }

  // Adopt server values when they arrive or change, but never overwrite unsaved edits:
  // a stale save then surfaces as a 409 conflict with an explicit reload.
  if (settings && settings.version_id !== appliedVersion && !dirty) {
    applyServer(settings)
  }

  const clearMessages = () => {
    setSaveSuccess(false)
    setErrorMessages([])
    setFieldErrors({})
  }

  const setField = <K extends FieldName>(key: K, value: SettingsForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaveSuccess(false)
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const handleReload = async () => {
    setIsReloading(true)
    clearMessages()
    try {
      const res = await refetch()
      if (res.data) applyServer(res.data)
      setIsConflict(false)
    } finally {
      setIsReloading(false)
    }
  }

  const handleCancel = () => {
    clearMessages()
    if (settings) applyServer(settings)
  }

  const handleSaveError = (err: unknown): void => {
    if (err instanceof ApiError && err.status === 409 && err.code === 'receipt_cycle_change_requires_confirmation') {
      return // handled by the caller, which owns the payload
    }
    if (err instanceof ApiError && err.status === 409) {
      setIsConflict(true)
      return
    }
    if (err instanceof ApiError && err.status === 422) {
      const { fields, general } = readValidationErrors(err)
      setFieldErrors(fields)
      const count = Object.keys(fields).length
      setErrorMessages([
        count > 0
          ? `Settings were not saved. Correct the ${count === 1 ? 'field' : `${count} fields`} marked below.`
          : 'Settings were not saved because some values are not valid.',
        ...general,
      ])
      return
    }
    setErrorMessages([err instanceof Error ? err.message : 'Failed to update settings'])
  }

  const submit = async (payload: ClinicSettingsUpdate) => {
    const updated = await updateMutation.mutateAsync(payload)
    applyServer(updated)
    setIsConflict(false)
    setSaveSuccess(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form || appliedVersion === null) return
    clearMessages()

    const days = Number(form.consultation_validity_days)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setFieldErrors({ consultation_validity_days: 'Enter a whole number of days from 1 to 365.' })
      setErrorMessages(['Settings were not saved. Correct the field marked below.'])
      return
    }

    const payload: ClinicSettingsUpdate = {
      name_en: form.name_en.trim(),
      name_hi: form.name_hi.trim(),
      address_1: form.address_1.trim(),
      address_2: form.address_2.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      receipt_sequence_cycle: form.receipt_sequence_cycle,
      print_header_en: form.print_header_en.trim() || null,
      print_header_hi: form.print_header_hi.trim() || null,
      print_footer_en: form.print_footer_en.trim() || null,
      print_footer_hi: form.print_footer_hi.trim() || null,
      consultation_validity_days: days,
      version_id: appliedVersion,
    }

    try {
      await submit(payload)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'receipt_cycle_change_requires_confirmation') {
        setChangeReason('')
        setCycleModalError(null)
        setPendingCycleChange({ payload, extra: readCycleExtra(err) })
        return
      }
      handleSaveError(err)
    }
  }

  const closeCycleModal = () => {
    setPendingCycleChange(null)
    setChangeReason('')
    setCycleModalError(null)
  }

  const confirmCycleChange = async () => {
    if (!pendingCycleChange) return
    const reason = changeReason.trim()
    if (!reason) {
      setCycleModalError('Enter a reason for changing the receipt numbering cycle.')
      return
    }
    setCycleModalError(null)
    try {
      await submit({ ...pendingCycleChange.payload, confirm_receipt_cycle_change: true, change_reason: reason })
      closeCycleModal()
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
        closeCycleModal()
        handleSaveError(err)
        return
      }
      setCycleModalError(err instanceof Error ? err.message : 'Failed to update settings')
    }
  }

  const saving = updateMutation.isPending
  const cycleChanging = form !== null && baseline !== null && form.receipt_sequence_cycle !== baseline.receipt_sequence_cycle

  const textInput = (
    key: Exclude<FieldName, 'receipt_sequence_cycle'>,
    opts: { required?: boolean; maxLength?: number; type?: string; lang?: string; inputMode?: 'tel' | 'email' | 'numeric' },
  ) =>
    (describedBy: string | undefined, invalid: boolean) => (
      <input
        id={`settings-${key}`}
        name={key}
        type={opts.type ?? 'text'}
        lang={opts.lang}
        inputMode={opts.inputMode}
        aria-required={opts.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={opts.maxLength}
        value={form?.[key] ?? ''}
        onChange={(e) => setField(key, e.target.value)}
        className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
      />
    )

  const textArea = (key: 'print_header_en' | 'print_header_hi' | 'print_footer_en' | 'print_footer_hi', lang?: string) =>
    (describedBy: string | undefined, invalid: boolean) => (
      <textarea
        id={`settings-${key}`}
        name={key}
        rows={3}
        lang={lang}
        maxLength={1000}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={form?.[key] ?? ''}
        onChange={(e) => setField(key, e.target.value)}
        className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
      />
    )

  const extra = pendingCycleChange?.extra
  const requestedCycle = pendingCycleChange?.payload.receipt_sequence_cycle

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <UnsavedChangesGuard dirty={dirty} />
      <div className="space-y-6 max-w-5xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Clinic Settings</h2>
          <p className="text-sm text-neutral-600">
            Hospital identity, contact details, receipt numbering, print text and consultation rules.
          </p>
        </div>

        {isConflict && <ConflictBanner onReload={handleReload} isReloading={isReloading} />}

        {saveSuccess && (
          <InlineAlert tone="success" onDismiss={() => setSaveSuccess(false)}>
            Clinic settings saved successfully.
          </InlineAlert>
        )}

        {errorMessages.length > 0 && (
          <InlineAlert tone="error" onDismiss={() => setErrorMessages([])}>
            {errorMessages.map((m, i) => (
              <p key={i}>{m}</p>
            ))}
          </InlineAlert>
        )}

        {isPending ? (
          <p className="text-sm text-neutral-600 py-8 text-center">Loading settings...</p>
        ) : isError ? (
          <InlineAlert tone="error">
            {error instanceof Error ? error.message : 'Failed to load clinic settings.'}
          </InlineAlert>
        ) : form ? (
          <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Clinic settings">
            <Section
              id="settings-section-identity"
              title="Hospital identity"
              description="The hospital name in English and Hindi, used on screens and printed documents."
            >
              <Field id="settings-name_en" label="Clinic Name (English)" error={fieldErrors.name_en}>
                {textInput('name_en', { required: true, maxLength: 120 })}
              </Field>
              <Field id="settings-name_hi" label="Clinic Name (Hindi)" error={fieldErrors.name_hi}>
                {textInput('name_hi', { required: true, maxLength: 120, lang: 'hi' })}
              </Field>
            </Section>

            <Section
              id="settings-section-contact"
              title="Contact & addresses"
              description="Phone, email and the clinic addresses printed on receipts, prescriptions and registration cards."
            >
              <Field
                id="settings-phone"
                label="Phone Number"
                error={fieldErrors.phone}
                hint="Digits, spaces and + - / , ( ) only."
              >
                {textInput('phone', { required: true, maxLength: 64, type: 'tel', inputMode: 'tel' })}
              </Field>
              <Field id="settings-email" label="Email (Optional)" error={fieldErrors.email}>
                {textInput('email', { maxLength: 120, type: 'email', inputMode: 'email' })}
              </Field>
              <Field id="settings-address_1" label="Primary Address" error={fieldErrors.address_1} className="md:col-span-2">
                {textInput('address_1', { required: true, maxLength: 255 })}
              </Field>
              <Field
                id="settings-address_2"
                label="Secondary Address (Optional)"
                error={fieldErrors.address_2}
                className="md:col-span-2"
              >
                {textInput('address_2', { maxLength: 255 })}
              </Field>
            </Section>

            <Section
              id="settings-section-billing"
              title="Billing — receipt numbering"
              description="How receipt numbers are grouped into yearly cycles. Each new cycle starts again at 0001."
            >
              <Field
                id="settings-receipt_sequence_cycle"
                label="Receipt Sequence Cycle"
                error={fieldErrors.receipt_sequence_cycle}
                hint={
                  <>
                    A receipt issued today in this cycle would be numbered like{' '}
                    <span className="font-mono font-semibold text-neutral-900">
                      {exampleReceiptNumber(form.receipt_sequence_cycle)}
                    </span>
                    . The cycle is worked out from the India (IST) date.
                  </>
                }
              >
                {(describedBy, invalid) => (
                  <select
                    id="settings-receipt_sequence_cycle"
                    name="receipt_sequence_cycle"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    value={form.receipt_sequence_cycle}
                    onChange={(e) => {
                      if (isReceiptCycle(e.target.value)) setField('receipt_sequence_cycle', e.target.value)
                    }}
                    className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
                  >
                    <option value="FINANCIAL_YEAR">
                      {CYCLE_LABEL.FINANCIAL_YEAR}, e.g. {exampleReceiptNumber('FINANCIAL_YEAR')}
                    </option>
                    <option value="CALENDAR_YEAR">
                      {CYCLE_LABEL.CALENDAR_YEAR}, e.g. {exampleReceiptNumber('CALENDAR_YEAR')}
                    </option>
                  </select>
                )}
              </Field>
              {cycleChanging && (
                <div className="self-start rounded-lg border border-[#C39A35] bg-[#FFF8E7] p-4 text-sm text-neutral-900">
                  You are changing the receipt numbering cycle. If receipts have already been issued in the
                  current cycle, you will be asked to confirm and give a reason before it is saved.
                </div>
              )}
            </Section>

            <Section
              id="settings-section-printing"
              title="Printing — header & footer"
              description="Optional text for printed documents, in English and Hindi."
            >
              <div className="md:col-span-2 rounded-lg border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-800">
                <p className="font-semibold text-neutral-900">Where this text is printed today</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>Print header (English and Hindi): not printed on any document yet.</li>
                  <li>
                    Print footer (Hindi): payment receipts and the patient registration card. When it is blank,
                    receipts print their built-in Hindi thank-you line.
                  </li>
                  <li>Print footer (English): the patient registration card only.</li>
                  <li>Prescriptions use the fixed letterhead with the clinic addresses and print neither field.</li>
                </ul>
              </div>
              <Field id="settings-print_header_en" label="Print Header (English)" error={fieldErrors.print_header_en}>
                {textArea('print_header_en')}
              </Field>
              <Field id="settings-print_header_hi" label="Print Header (Hindi)" error={fieldErrors.print_header_hi}>
                {textArea('print_header_hi', 'hi')}
              </Field>
              <Field id="settings-print_footer_en" label="Print Footer (English)" error={fieldErrors.print_footer_en}>
                {textArea('print_footer_en')}
              </Field>
              <Field id="settings-print_footer_hi" label="Print Footer (Hindi)" error={fieldErrors.print_footer_hi}>
                {textArea('print_footer_hi', 'hi')}
              </Field>
            </Section>

            <Section
              id="settings-section-consultation"
              title="Consultation"
              description="Rules for consultations and the patient registration card."
            >
              <Field
                id="settings-consultation_validity_days"
                label="Consultation Validity (Days)"
                error={fieldErrors.consultation_validity_days}
                hint="Printed on the patient registration card as its validity period (1 to 365 days). The server does not use it to expire consultations."
              >
                {(describedBy, invalid) => (
                  <input
                    id="settings-consultation_validity_days"
                    name="consultation_validity_days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    step={1}
                    aria-required
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    value={form.consultation_validity_days}
                    onChange={(e) => setField('consultation_validity_days', e.target.value)}
                    className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
                  />
                )}
              </Field>
            </Section>

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-6 py-4 shadow-md">
              <p className="text-sm text-neutral-700" aria-live="polite">
                {dirty ? 'You have unsaved changes.' : 'No unsaved changes.'}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={!dirty || saving}
                  className="px-4 py-2 text-sm font-medium text-neutral-800 bg-white border border-neutral-300 hover:bg-neutral-100 rounded min-h-11 min-w-11 focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!dirty || saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-[#8E1C3D] hover:bg-[#5D0B26] rounded min-h-11 min-w-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </div>

      <Modal
        open={pendingCycleChange !== null}
        onClose={closeCycleModal}
        variant="destructive"
        dismiss="none"
        busy={saving}
        title="Change the receipt numbering cycle?"
        className="max-w-lg"
      >
        {extra && requestedCycle && (
          <div className="space-y-4 text-sm text-neutral-800">
            <p>
              <span className="font-semibold">{extra.receipts_issued}</span>{' '}
              {extra.receipts_issued === 1 ? 'receipt has' : 'receipts have'} already been issued in the current cycle ({cycleLabel(extra.current_cycle)}, cycle key{' '}
              <span className="font-mono font-semibold">{extra.current_cycle_key}</span>). Those receipts keep their
              numbers.
            </p>
            <p>
              After this change, numbering continues under a new cycle key:{' '}
              <span className="font-mono font-semibold">{cycleKeyForToday(requestedCycle)}</span> (
              {cycleLabel(requestedCycle)}). New receipts are numbered{' '}
              <span className="font-mono font-semibold">RCP-{cycleKeyForToday(requestedCycle)}-NNNN</span>, carrying on
              from that key&apos;s last number, or from 0001 if it has not been used before.
            </p>
            <p>The change and your reason are recorded in the audit log.</p>

            <div>
              <label htmlFor="settings-cycle-change-reason" className="block text-sm font-medium text-neutral-800 mb-1">
                Reason for the change (required)
              </label>
              <textarea
                id="settings-cycle-change-reason"
                data-autofocus
                rows={3}
                maxLength={CHANGE_REASON_MAX_LENGTH}
                aria-required
                aria-describedby="settings-cycle-change-reason-count"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                className={`${INPUT_CLASS} border-neutral-300`}
              />
              <p id="settings-cycle-change-reason-count" className="mt-1 text-sm text-neutral-600">
                {changeReason.length}/{CHANGE_REASON_MAX_LENGTH} characters
              </p>
            </div>

            {cycleModalError && <InlineAlert tone="error">{cycleModalError}</InlineAlert>}

            <div className="flex justify-end gap-3 border-t border-neutral-200 pt-4">
              <button
                type="button"
                onClick={closeCycleModal}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-neutral-800 bg-white border border-neutral-300 hover:bg-neutral-100 rounded min-h-11 min-w-11 focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer"
              >
                Keep current cycle
              </button>
              <button
                type="button"
                onClick={confirmCycleChange}
                disabled={saving || changeReason.trim() === ''}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-800 hover:bg-red-900 rounded min-h-11 min-w-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Change cycle and save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
