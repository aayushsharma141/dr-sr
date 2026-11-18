import { useState, type FormEvent } from 'react'
import {
  useDoctors,
  useCreateDoctor,
  useUpdateDoctor,
  useFees,
  useCreateFee,
  useUpdateFee,
  useMe,
} from '../api/queries'
import { ApiError } from '../api/client'
import { AppShell } from '../components/AppShell'
import { TableSkeleton } from '../components/AdminSkeleton'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { toast } from '../components/ToastHost'
import type { DoctorOut, DoctorCreate, DoctorUpdate, FeeOut } from '../api/types'

interface DoctorForm {
  name_en: string
  name_hi: string
  qualification: string
  registration_number: string
  cabin_code: string
  fee_rupees: string
  is_active: boolean
}

interface FeeForm {
  name: string
  fee_rupees: string
  is_active: boolean
}

const EMPTY_DOCTOR_FORM: DoctorForm = {
  name_en: '',
  name_hi: '',
  qualification: '',
  registration_number: '',
  cabin_code: '',
  fee_rupees: '500',
  is_active: true,
}

const EMPTY_FEE_FORM: FeeForm = { name: '', fee_rupees: '500', is_active: true }

function doctorToForm(doc: DoctorOut): DoctorForm {
  return {
    name_en: doc.name_en,
    name_hi: doc.name_hi ?? '',
    qualification: doc.qualification ?? '',
    registration_number: doc.registration_number ?? '',
    cabin_code: doc.cabin_code ?? '',
    fee_rupees: String(doc.default_fee_paise / 100),
    is_active: doc.is_active,
  }
}

function feeToForm(fee: FeeOut): FeeForm {
  return { name: fee.name, fee_rupees: String(fee.fee_paise / 100), is_active: fee.is_active }
}

function doctorFormsEqual(a: DoctorForm, b: DoctorForm): boolean {
  return (
    a.name_en === b.name_en &&
    a.name_hi === b.name_hi &&
    a.qualification === b.qualification &&
    a.registration_number === b.registration_number &&
    a.cabin_code === b.cabin_code &&
    a.fee_rupees === b.fee_rupees &&
    a.is_active === b.is_active
  )
}

function feeFormsEqual(a: FeeForm, b: FeeForm): boolean {
  return a.name === b.name && a.fee_rupees === b.fee_rupees && a.is_active === b.is_active
}

/** Rupees typed by the user to integer paise; null when not a non-negative amount with at most 2 decimals. */
function rupeesToPaise(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`
}

/** Readable messages from an error, including the per-field messages of a 422 validation_error. */
function errorMessages(err: unknown, fallback: string): string[] {
  if (!(err instanceof Error)) return [fallback]
  if (err instanceof ApiError && err.status === 422 && Array.isArray(err.extra.fields)) {
    const details = err.extra.fields.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const rec = item as Record<string, unknown>
      const loc = Array.isArray(rec.loc) ? rec.loc.map(String).filter((l) => l !== 'body') : []
      const message = (typeof rec.message === 'string' ? rec.message : 'Invalid value').replace(/^Value error, /, '')
      return [loc.length > 0 ? `${loc.join('.')}: ${message}` : message]
    })
    return [err.message, ...details]
  }
  return [err.message || fallback]
}

const INPUT_CLASS =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'
const PRIMARY_BUTTON =
  'inline-flex min-h-[38px] items-center justify-center rounded-lg bg-[#8E1C3D] px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed'
const SECONDARY_BUTTON =
  'inline-flex min-h-[38px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-2xs'
const ROW_BUTTON =
  'inline-flex min-h-[34px] items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-2xs'

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        active ? 'bg-green-100 text-green-900' : 'bg-neutral-200 text-neutral-800'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

type DiscardTarget = 'doctor' | 'fee'

export function Doctors() {
  const { data: me } = useMe()
  const {
    data: doctors,
    isPending: doctorsLoading,
    isError: doctorsIsError,
    error: doctorsError,
    refetch: refetchDoctors,
  } = useDoctors()
  // All fees (active and inactive); "Show inactive" only filters what is displayed.
  const {
    data: fees,
    isPending: feesLoading,
    isError: feesIsError,
    error: feesError,
    refetch: refetchFees,
  } = useFees()

  const createDoctorMutation = useCreateDoctor()
  const updateDoctorMutation = useUpdateDoctor()
  const createFeeMutation = useCreateFee()
  const updateFeeMutation = useUpdateFee()

  // Doctor modal state
  const [doctorModalOpen, setDoctorModalOpen] = useState(false)
  const [editingDoctor, setEditingDoctor] = useState<DoctorOut | null>(null)
  const [docForm, setDocForm] = useState<DoctorForm>(EMPTY_DOCTOR_FORM)
  const [docInitial, setDocInitial] = useState<DoctorForm>(EMPTY_DOCTOR_FORM)
  const [docErrors, setDocErrors] = useState<string[]>([])
  const [docConflict, setDocConflict] = useState(false)
  const [docReloading, setDocReloading] = useState(false)

  // Fee modal state
  const [feeModalOpen, setFeeModalOpen] = useState(false)
  const [editingFee, setEditingFee] = useState<FeeOut | null>(null)
  const [feeForm, setFeeForm] = useState<FeeForm>(EMPTY_FEE_FORM)
  const [feeInitial, setFeeInitial] = useState<FeeForm>(EMPTY_FEE_FORM)
  const [feeErrors, setFeeErrors] = useState<string[]>([])
  const [feeConflict, setFeeConflict] = useState(false)
  const [feeReloading, setFeeReloading] = useState(false)

  // Fee list state
  const [showInactiveFees, setShowInactiveFees] = useState(false)
  const [reactivatingFeeId, setReactivatingFeeId] = useState<number | null>(null)
  const [feeListConflict, setFeeListConflict] = useState(false)
  const [feeListReloading, setFeeListReloading] = useState(false)

  const [discardTarget, setDiscardTarget] = useState<DiscardTarget | null>(null)

  const docDirty = doctorModalOpen && !doctorFormsEqual(docForm, docInitial)
  const feeDirty = feeModalOpen && !feeFormsEqual(feeForm, feeInitial)
  const docSaving = createDoctorMutation.isPending || updateDoctorMutation.isPending
  const feeSaving = createFeeMutation.isPending || updateFeeMutation.isPending

  const allFees = fees ?? []
  const inactiveFeeCount = allFees.filter((f) => !f.is_active).length
  const visibleFees = showInactiveFees ? allFees : allFees.filter((f) => f.is_active)

  // ---------------------------------------------------------------- doctors

  const setDocField = <K extends keyof DoctorForm>(key: K, value: DoctorForm[K]) =>
    setDocForm((prev) => ({ ...prev, [key]: value }))

  const loadDoctorForm = (form: DoctorForm) => {
    setDocForm(form)
    setDocInitial(form)
  }

  const openCreateDoctor = () => {
    setEditingDoctor(null)
    loadDoctorForm(EMPTY_DOCTOR_FORM)
    setDocErrors([])
    setDocConflict(false)
    setDoctorModalOpen(true)
  }

  const openEditDoctor = (doc: DoctorOut) => {
    setEditingDoctor(doc)
    loadDoctorForm(doctorToForm(doc))
    setDocErrors([])
    setDocConflict(false)
    setDoctorModalOpen(true)
  }

  const closeDoctorModal = () => {
    setDoctorModalOpen(false)
    setDiscardTarget(null)
  }

  const requestCloseDoctorModal = () => {
    if (docDirty) setDiscardTarget('doctor')
    else closeDoctorModal()
  }

  const handleReloadDoctor = async () => {
    if (!editingDoctor) return
    setDocReloading(true)
    try {
      const refreshedList = await refetchDoctors()
      const freshDoc = refreshedList.data?.find((d) => d.id === editingDoctor.id)
      if (freshDoc) {
        loadDoctorForm(doctorToForm(freshDoc))
        setEditingDoctor(freshDoc)
      }
      setDocErrors([])
      setDocConflict(false)
    } finally {
      setDocReloading(false)
    }
  }

  const handleDoctorSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setDocErrors([])

    const feePaise = rupeesToPaise(docForm.fee_rupees)
    if (feePaise === null) {
      setDocErrors(['Enter the default fee in rupees, for example 500 or 450.50.'])
      return
    }

    const cabinCodeVal = docForm.cabin_code.trim() ? docForm.cabin_code.trim().toUpperCase() : null

    if (editingDoctor) {
      const body: DoctorUpdate = {
        name_en: docForm.name_en.trim(),
        name_hi: docForm.name_hi.trim() || null,
        qualification: docForm.qualification.trim() || null,
        registration_number: docForm.registration_number.trim() || null,
        cabin_code: cabinCodeVal,
        default_fee_paise: feePaise,
        is_active: docForm.is_active,
        version_id: editingDoctor.version_id,
      }

      try {
        await updateDoctorMutation.mutateAsync({ id: editingDoctor.id, body })
        toast.success(`Updated doctor profile: ${docForm.name_en.trim()}.`)
        closeDoctorModal()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          if (err.code === 'cabin_code_taken') {
            setDocErrors([err.message])
          } else {
            setDocConflict(true)
          }
        } else {
          setDocErrors(errorMessages(err, 'Failed to update doctor profile'))
        }
      }
    } else {
      const body: DoctorCreate = {
        name_en: docForm.name_en.trim(),
        name_hi: docForm.name_hi.trim() || null,
        qualification: docForm.qualification.trim() || null,
        registration_number: docForm.registration_number.trim() || null,
        cabin_code: cabinCodeVal,
        default_fee_paise: feePaise,
      }

      try {
        await createDoctorMutation.mutateAsync(body)
        toast.success(`Added doctor profile: ${docForm.name_en.trim()}.`)
        closeDoctorModal()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === 'cabin_code_taken') {
          setDocErrors([err.message])
        } else {
          setDocErrors(errorMessages(err, 'Failed to create doctor profile'))
        }
      }
    }
  }

  // ------------------------------------------------------------------- fees

  const setFeeField = <K extends keyof FeeForm>(key: K, value: FeeForm[K]) =>
    setFeeForm((prev) => ({ ...prev, [key]: value }))

  const loadFeeForm = (form: FeeForm) => {
    setFeeForm(form)
    setFeeInitial(form)
  }

  const openCreateFee = () => {
    setEditingFee(null)
    loadFeeForm(EMPTY_FEE_FORM)
    setFeeErrors([])
    setFeeConflict(false)
    setFeeModalOpen(true)
  }

  const openEditFee = (fee: FeeOut) => {
    setEditingFee(fee)
    loadFeeForm(feeToForm(fee))
    setFeeErrors([])
    setFeeConflict(false)
    setFeeModalOpen(true)
  }

  const closeFeeModal = () => {
    setFeeModalOpen(false)
    setDiscardTarget(null)
  }

  const requestCloseFeeModal = () => {
    if (feeDirty) setDiscardTarget('fee')
    else closeFeeModal()
  }

  const handleReloadFee = async () => {
    if (!editingFee) return
    setFeeReloading(true)
    try {
      const refreshed = await refetchFees()
      const freshFee = refreshed.data?.find((f) => f.id === editingFee.id)
      if (freshFee) {
        loadFeeForm(feeToForm(freshFee))
        setEditingFee(freshFee)
      }
      setFeeErrors([])
      setFeeConflict(false)
    } finally {
      setFeeReloading(false)
    }
  }

  const handleFeeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFeeErrors([])

    const feePaise = rupeesToPaise(feeForm.fee_rupees)
    if (feePaise === null) {
      setFeeErrors(['Enter the fee in rupees, for example 300 or 250.50.'])
      return
    }

    if (editingFee) {
      try {
        await updateFeeMutation.mutateAsync({
          id: editingFee.id,
          body: {
            name: feeForm.name.trim(),
            fee_paise: feePaise,
            is_active: feeForm.is_active,
            version_id: editingFee.version_id,
          },
        })
        toast.success(`Updated fee rate "${feeForm.name.trim()}".`)
        closeFeeModal()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setFeeConflict(true)
        } else {
          setFeeErrors(errorMessages(err, 'Failed to update fee schedule'))
        }
      }
    } else {
      try {
        await createFeeMutation.mutateAsync({ name: feeForm.name.trim(), fee_paise: feePaise })
        toast.success(`Added fee rate "${feeForm.name.trim()}".`)
        closeFeeModal()
      } catch (err) {
        setFeeErrors(errorMessages(err, 'Failed to create fee schedule'))
      }
    }
  }

  const handleReactivateFee = async (fee: FeeOut) => {
    setReactivatingFeeId(fee.id)
    try {
      await updateFeeMutation.mutateAsync({
        id: fee.id,
        body: { name: fee.name, fee_paise: fee.fee_paise, is_active: true, version_id: fee.version_id },
      })
      setFeeListConflict(false)
      toast.success(`Fee rate "${fee.name}" is active again.`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFeeListConflict(true)
      } else {
        toast.error(errorMessages(err, 'Failed to reactivate fee rate').join(' '))
      }
    } finally {
      setReactivatingFeeId(null)
    }
  }

  const handleReloadFeeList = async () => {
    setFeeListReloading(true)
    try {
      await refetchFees()
      setFeeListConflict(false)
    } finally {
      setFeeListReloading(false)
    }
  }

  const confirmDiscard = () => {
    if (discardTarget === 'doctor') closeDoctorModal()
    else if (discardTarget === 'fee') closeFeeModal()
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight text-slate-900">
          Doctors &amp; Fees
        </h1>

        {/* Doctors Section */}
        <section
          aria-labelledby="doctors-heading"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id="doctors-heading" className="text-base font-semibold tracking-tight text-slate-900">
                Doctor Profiles
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Credentials, qualifications and default fees
              </p>
            </div>
            <button type="button" onClick={openCreateDoctor} className={PRIMARY_BUTTON}>
              Add Doctor
            </button>
          </div>

          {doctorsLoading ? (
            <div className="p-4">
              <TableSkeleton label="Loading doctors..." rows={4} columns={8} />
            </div>
          ) : doctorsIsError ? (
            <div className="p-4">
              <InlineAlert
                tone="error"
                action={
                  <button type="button" onClick={() => void refetchDoctors()} className={SECONDARY_BUTTON}>
                    Retry
                  </button>
                }
              >
                Failed to load doctor profiles: {doctorsError instanceof Error ? doctorsError.message : 'Unable to reach server.'}
              </InlineAlert>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-800">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Doctor Name</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Hindi Name</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Qualification</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Registration No</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Cabin</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Default Fee</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Status</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {doctors && doctors.length > 0 ? (
                    doctors.map((doc) => (
                      <tr key={doc.id} className="transition-colors duration-150 hover:bg-slate-50/80">
                        <td className="max-w-[220px] px-4 py-3">
                          <div className="min-w-0 truncate font-medium text-slate-900" title={doc.name_en}>
                            {doc.name_en}
                          </div>
                        </td>
                        <td className="max-w-[200px] px-4 py-3 text-slate-700" lang={doc.name_hi ? 'hi' : undefined}>
                          <div className="min-w-0 truncate" title={doc.name_hi || undefined}>
                            {doc.name_hi || '-'}
                          </div>
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-slate-700">
                          <div className="min-w-0 truncate" title={doc.qualification || undefined}>
                            {doc.qualification || '-'}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-slate-700">
                          {doc.registration_number || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold tabular-nums text-slate-800">
                          {doc.cabin_code || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                          {formatRupees(doc.default_fee_paise)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge active={doc.is_active} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditDoctor(doc)}
                            aria-label={`Edit ${doc.name_en}`}
                            className={ROW_BUTTON}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center">
                        <p className="text-sm font-medium text-slate-700">No doctors registered yet.</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Use Add Doctor to configure practitioner profiles, cabins, and consultation fees.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Consultation Fees Section */}
        <section
          aria-labelledby="fees-heading"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id="fees-heading" className="text-base font-semibold tracking-tight text-slate-900">
                Consultation Fee Schedules
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Configure standard fee rates used across departments and billing
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <label
                htmlFor="fees-show-inactive"
                className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium tabular-nums text-slate-700 transition-colors duration-150 hover:bg-slate-100"
              >
                <input
                  id="fees-show-inactive"
                  type="checkbox"
                  checked={showInactiveFees}
                  onChange={(e) => setShowInactiveFees(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-400 accent-[#8E1C3D]"
                />
                Show inactive ({inactiveFeeCount})
              </label>
              <button type="button" onClick={openCreateFee} className={PRIMARY_BUTTON}>
                Add Fee Rate
              </button>
            </div>
          </div>

          {feeListConflict && (
            <div className="space-y-3 border-b border-slate-100 px-5 py-3.5">
              <ConflictBanner onReload={handleReloadFeeList} isReloading={feeListReloading} />
            </div>
          )}

          {feesLoading ? (
            <div className="p-4">
              <TableSkeleton label="Loading fees..." rows={3} columns={4} />
            </div>
          ) : feesIsError ? (
            <div className="p-4">
              <InlineAlert
                tone="error"
                action={
                  <button type="button" onClick={() => void refetchFees()} className={SECONDARY_BUTTON}>
                    Retry
                  </button>
                }
              >
                Failed to load consultation fee schedules: {feesError instanceof Error ? feesError.message : 'Unable to reach server.'}
              </InlineAlert>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-800">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Schedule Name</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Rate (INR)</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Status</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleFees.length > 0 ? (
                    visibleFees.map((fee) => (
                      <tr
                        key={fee.id}
                        className={`transition-colors duration-150 ${fee.is_active ? 'hover:bg-slate-50/80' : 'bg-slate-50/60'}`}
                      >
                        <td className="max-w-[320px] px-4 py-3">
                          <div className="min-w-0 truncate font-medium text-slate-900" title={fee.name}>
                            {fee.name}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                          {formatRupees(fee.fee_paise)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge active={fee.is_active} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {!fee.is_active && (
                              <button
                                type="button"
                                onClick={() => handleReactivateFee(fee)}
                                disabled={reactivatingFeeId !== null}
                                aria-label={`Reactivate ${fee.name}`}
                                className={ROW_BUTTON}
                              >
                                {reactivatingFeeId === fee.id ? 'Reactivating...' : 'Reactivate'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditFee(fee)}
                              aria-label={`Edit ${fee.name}`}
                              className={ROW_BUTTON}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-sm text-slate-600">
                        {allFees.length === 0
                          ? 'No fee schedules configured yet.'
                          : 'No active fee schedules. Tick "Show inactive" to see deactivated rates.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Doctor Modal */}
        {doctorModalOpen && (
          <Modal
            open
            title={editingDoctor ? 'Edit Doctor Profile' : 'Add Doctor Profile'}
            onClose={requestCloseDoctorModal}
            dismiss={docDirty ? 'none' : 'closerequest'}
            busy={docSaving}
            className="max-w-lg"
          >
            <div className="space-y-4">
              {docConflict && <ConflictBanner onReload={handleReloadDoctor} isReloading={docReloading} />}

              {docErrors.length > 0 && (
                <InlineAlert tone="error">
                  {docErrors.map((m, i) => (
                    <p key={i}>{m}</p>
                  ))}
                </InlineAlert>
              )}

              <form onSubmit={handleDoctorSubmit} className="space-y-4">
                <div>
                  <label htmlFor="doc-name-en" className="mb-1.5 block text-xs font-semibold text-slate-700">
                    English Name
                  </label>
                  <input
                    id="doc-name-en"
                    data-autofocus
                    type="text"
                    required
                    maxLength={120}
                    value={docForm.name_en}
                    onChange={(e) => setDocField('name_en', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="doc-name-hi" className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Hindi Name (Optional)
                  </label>
                  <input
                    id="doc-name-hi"
                    type="text"
                    lang="hi"
                    value={docForm.name_hi}
                    onChange={(e) => setDocField('name_hi', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="doc-qualification" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Qualification (e.g., MBBS, MS Ortho)
                    </label>
                    <input
                      id="doc-qualification"
                      type="text"
                      value={docForm.qualification}
                      onChange={(e) => setDocField('qualification', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor="doc-reg-no" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Registration Number (Optional)
                    </label>
                    <input
                      id="doc-reg-no"
                      type="text"
                      value={docForm.registration_number}
                      onChange={(e) => setDocField('registration_number', e.target.value)}
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="doc-cabin-code" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Cabin Code (Optional, A–Z)
                    </label>
                    <input
                      id="doc-cabin-code"
                      type="text"
                      maxLength={1}
                      value={docForm.cabin_code}
                      onChange={(e) => setDocField('cabin_code', e.target.value.toUpperCase())}
                      placeholder="e.g. A"
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>

                  <div>
                    <label htmlFor="doc-default-fee" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Default Consultation Fee (₹ INR)
                    </label>
                    <input
                      id="doc-default-fee"
                      type="number"
                      inputMode="decimal"
                      required
                      min={0}
                      step="0.01"
                      value={docForm.fee_rupees}
                      onChange={(e) => setDocField('fee_rupees', e.target.value)}
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                {editingDoctor && (
                  <div className="flex min-h-9 items-center gap-2">
                    <input
                      id="doc-active"
                      type="checkbox"
                      checked={docForm.is_active}
                      onChange={(e) => setDocField('is_active', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-400 accent-[#8E1C3D]"
                    />
                    <label htmlFor="doc-active" className="text-sm font-medium text-slate-800 cursor-pointer">
                      Active doctor profile
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4">
                  <button type="button" onClick={requestCloseDoctorModal} disabled={docSaving} className={SECONDARY_BUTTON}>
                    Cancel
                  </button>
                  <button type="submit" disabled={docSaving} className={PRIMARY_BUTTON}>
                    {docSaving ? 'Saving...' : 'Save Doctor'}
                  </button>
                </div>
              </form>
            </div>
          </Modal>
        )}

        {/* Fee Modal */}
        {feeModalOpen && (
          <Modal
            open
            title={editingFee ? 'Edit Fee Rate' : 'Add Fee Rate'}
            onClose={requestCloseFeeModal}
            dismiss={feeDirty ? 'none' : 'closerequest'}
            busy={feeSaving}
            className="max-w-md"
          >
            <div className="space-y-4">
              {feeConflict && <ConflictBanner onReload={handleReloadFee} isReloading={feeReloading} />}

              {feeErrors.length > 0 && (
                <InlineAlert tone="error">
                  {feeErrors.map((m, i) => (
                    <p key={i}>{m}</p>
                  ))}
                </InlineAlert>
              )}

              <form onSubmit={handleFeeSubmit} className="space-y-4">
                <div>
                  <label htmlFor="fee-name" className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Schedule Name
                  </label>
                  <input
                    id="fee-name"
                    data-autofocus
                    type="text"
                    required
                    maxLength={120}
                    value={feeForm.name}
                    onChange={(e) => setFeeField('name', e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label htmlFor="fee-amount" className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Fee Rate (₹ INR)
                  </label>
                  <input
                    id="fee-amount"
                    type="number"
                    inputMode="decimal"
                    required
                    min={0}
                    step="0.01"
                    value={feeForm.fee_rupees}
                    onChange={(e) => setFeeField('fee_rupees', e.target.value)}
                    className={`${INPUT_CLASS} font-mono tabular-nums`}
                  />
                </div>

                {editingFee && (
                  <div className="flex min-h-9 items-center gap-2">
                    <input
                      id="fee-active"
                      type="checkbox"
                      checked={feeForm.is_active}
                      onChange={(e) => setFeeField('is_active', e.target.checked)}
                      className="h-4 w-4 rounded border-slate-400 accent-[#8E1C3D]"
                    />
                    <label htmlFor="fee-active" className="text-sm font-medium text-slate-800 cursor-pointer">
                      Active rate
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4">
                  <button type="button" onClick={requestCloseFeeModal} disabled={feeSaving} className={SECONDARY_BUTTON}>
                    Cancel
                  </button>
                  <button type="submit" disabled={feeSaving} className={PRIMARY_BUTTON}>
                    {feeSaving ? 'Saving...' : 'Save Rate'}
                  </button>
                </div>
              </form>
            </div>
          </Modal>
        )}

        <Modal
          open={discardTarget !== null}
          onClose={() => setDiscardTarget(null)}
          variant="warning"
          dismiss="none"
          title="Discard unsaved changes?"
          description={
            discardTarget === 'fee'
              ? 'The changes to this fee rate have not been saved and will be lost.'
              : 'The changes to this doctor profile have not been saved and will be lost.'
          }
          className="max-w-md"
        >
          <div className="flex justify-end gap-2.5 pt-2">
            <button type="button" data-autofocus onClick={() => setDiscardTarget(null)} className={SECONDARY_BUTTON}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={confirmDiscard}
              className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-red-800 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Discard changes
            </button>
          </div>
        </Modal>
      </div>
    </AppShell>
  )
}
