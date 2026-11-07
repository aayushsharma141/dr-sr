import React, { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ReceiptDialog } from '../components/ReceiptDialog'
import { PaymentModal } from '../components/PaymentModal'
import {
  useMe,
  usePatients,
  usePatient,
  useDoctors,
  useRecordPayment,
  useLedger,
  usePendingDues,
} from '../api/queries'
import type { PatientOut, PaymentOut, PaymentMethod, PendingDueOut } from '../api/types'
import { PAYMENT_RECORDED_EVENT } from '../components/ReceiptHost'
import {
  IconCheck,
  IconClock,
  IconDeviceFloppy,
  IconPrinter,
  IconReceipt,
  IconRupee,
  IconSearch,
  IconStethoscope,
  IconTicket,
  IconUser,
  IconX,
} from '../components/icons'

function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100).toLocaleString('en-IN')
  return `₹${rupees}.${String(paise % 100).padStart(2, '0')}`
}

function formatIst(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function ReceptionBillingPage() {
  const { data: me } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()

  const requestedTab = searchParams.get('tab') || 'checkout'
  const patientIdParam = searchParams.get('patient_id')

  // State
  const [activeTab, setActiveTab] = useState<'checkout' | 'ledger' | 'dues'>(
    requestedTab === 'ledger' || requestedTab === 'dues' ? requestedTab : 'checkout',
  )

  // Sync tab with URL
  const handleTabChange = (tab: 'checkout' | 'ledger' | 'dues') => {
    setActiveTab(tab)
    setSearchParams(tab === 'checkout' ? {} : { tab })
  }

  // --- TAB 1: CHECKOUT / COLLECT PAYMENT STATE ---
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(null)
  const [serviceType, setServiceType] = useState<'opd_consultation' | 'follow_up' | 'physio_session' | 'custom'>('opd_consultation')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('')
  const [amountRupees, setAmountRupees] = useState<string>('400.00')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [notes, setNotes] = useState<string>('')

  const [recordedPayment, setRecordedPayment] = useState<PaymentOut | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Queries
  const { data: searchResults, isPending: isSearching } = usePatients(searchQuery, 8, 0)
  const { data: preloadedPatient } = usePatient(patientIdParam ? Number(patientIdParam) : 0)
  const { data: doctors } = useDoctors(false)

  // Auto-select patient if provided via URL
  useEffect(() => {
    if (preloadedPatient && !selectedPatient) {
      setSelectedPatient(preloadedPatient)
    }
  }, [preloadedPatient, selectedPatient])

  // Update amount when service type changes
  const handleServiceChange = (val: 'opd_consultation' | 'follow_up' | 'physio_session' | 'custom') => {
    setServiceType(val)
    if (val === 'opd_consultation') {
      const doc = doctors?.find((d) => String(d.id) === selectedDoctorId)
      setAmountRupees(doc ? (doc.default_fee_paise / 100).toFixed(2) : '400.00')
    } else if (val === 'follow_up') {
      setAmountRupees('200.00')
    } else if (val === 'physio_session') {
      setAmountRupees('500.00')
    } else {
      setAmountRupees('')
    }
  }

  const handleDoctorChange = (docId: string) => {
    setSelectedDoctorId(docId)
    if (serviceType === 'opd_consultation' && docId) {
      const doc = doctors?.find((d) => String(d.id) === docId)
      if (doc) {
        setAmountRupees((doc.default_fee_paise / 100).toFixed(2))
      }
    }
  }

  const recordPaymentMutation = useRecordPayment()

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!selectedPatient) {
      setFormError('Please search and select a patient to checkout.')
      return
    }

    const parsed = parseFloat(amountRupees)
    if (isNaN(parsed) || parsed <= 0) {
      setFormError('Please enter a valid payment amount in rupees.')
      return
    }

    const amountPaise = Math.round(parsed * 100)

    try {
      const res = await recordPaymentMutation.mutateAsync({
        patient_id: selectedPatient.id,
        amount_paise: amountPaise,
        payment_method: paymentMethod,
        notes: notes.trim() || `OPD ${serviceType.replace('_', ' ').toUpperCase()}`,
      })

      setRecordedPayment(res)
      // Trigger receipt print dialog automatically via app-level ReceiptHost
      window.dispatchEvent(new CustomEvent(PAYMENT_RECORDED_EVENT, { detail: res }))
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message)
      } else {
        setFormError('Failed to record payment and issue receipt.')
      }
    }
  }

  const handleResetCheckout = () => {
    setSelectedPatient(null)
    setSearchQuery('')
    setAmountRupees('400.00')
    setServiceType('opd_consultation')
    setPaymentMethod('CASH')
    setNotes('')
    setRecordedPayment(null)
    setFormError(null)
  }

  // --- TAB 2: LEDGER STATE ---
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerStatus, setLedgerStatus] = useState<'all' | 'active' | 'reversed'>('all')
  const [reprintPayment, setReprintPayment] = useState<PaymentOut | null>(null)

  const { data: ledgerPayments, isLoading: ledgerLoading } = useLedger({
    q: ledgerSearch,
    status: ledgerStatus,
  })

  // --- TAB 3: PENDING DUES STATE ---
  const { data: pendingDues, isLoading: duesLoading } = usePendingDues()
  const [duesSearch, setDuesSearch] = useState('')
  const [dueToCollect, setDueToCollect] = useState<PendingDueOut | null>(null)

  const filteredDues = useMemo(() => {
    if (!pendingDues) return []
    const q = duesSearch.trim().toLowerCase()
    if (!q) return pendingDues
    return pendingDues.filter(
      (d) =>
        d.patient_name.toLowerCase().includes(q) ||
        d.patient_urn.toLowerCase().includes(q) ||
        d.plan_name.toLowerCase().includes(q),
    )
  }, [pendingDues, duesSearch])

  const totalOutstandingPaise = useMemo(() => {
    return filteredDues.reduce((acc, curr) => acc + curr.balance_paise, 0)
  }, [filteredDues])

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        {/* Top Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs shrink-0">
              <IconReceipt className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Reception Billing &amp; Payment Desk
              </h1>
              <p className="text-xs text-slate-500">
                Collect OPD consultation charges, issue sequential receipts, and manage package ledger balances.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              to="/reception/appointments"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconTicket className="h-4 w-4 text-emerald-800" />
              Waiting Queue / OPD
            </Link>
            <Link
              to="/reception/tokens"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconUser className="h-4 w-4 text-slate-500" />
              Visit &amp; Token Desk
            </Link>
          </div>
        </div>

        {/* Tab Navigation Navigation Bar */}
        <div className="flex border-b border-slate-200 bg-white px-4 pt-2 rounded-xl shadow-2xs">
          <button
            type="button"
            onClick={() => handleTabChange('checkout')}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition-all ${activeTab === 'checkout'
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
          >
            <IconRupee className="h-4 w-4" />
            Counter Checkout &amp; Collect
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('ledger')}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition-all ${activeTab === 'ledger'
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
          >
            <IconReceipt className="h-4 w-4" />
            Today&apos;s Receipts &amp; Ledger
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('dues')}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-bold transition-all ${activeTab === 'dues'
                ? 'border-emerald-800 text-emerald-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
          >
            <IconClock className="h-4 w-4" />
            Outstanding Package Dues
          </button>
        </div>

        {/* ======================================================== */}
        {/* TAB 1: COUNTER CHECKOUT / COLLECT PAYMENT                */}
        {/* ======================================================== */}
        {activeTab === 'checkout' && (
          <div className="space-y-5">
            {/* Success Card when payment is recorded */}
            {recordedPayment && (
              <div
                role="status"
                className="space-y-4 rounded-2xl border border-emerald-300 bg-emerald-50/90 p-6 text-emerald-950 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white font-bold">
                      <IconCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-emerald-950">
                        Payment Recorded &amp; Receipt Issued!
                      </h3>
                      <p className="text-xs text-emerald-800">
                        Receipt <span className="font-mono font-bold">{recordedPayment.receipt_number}</span> issued for{' '}
                        <span className="font-semibold">{recordedPayment.patient_name}</span> ({recordedPayment.patient_urn}).
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-300 bg-white px-5 py-3 text-center shadow-xs">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Amount Collected
                    </span>
                    <div className="font-mono text-2xl font-black text-emerald-800">
                      {formatPaise(recordedPayment.amount_paise)}
                    </div>
                    <span className="text-xs font-bold text-slate-600 uppercase">
                      {recordedPayment.payment_method}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-emerald-200">
                  <button
                    type="button"
                    onClick={() => setReprintPayment(recordedPayment)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 shadow-xs cursor-pointer"
                  >
                    <IconPrinter className="h-4 w-4" />
                    Print Receipt Slip (A4 / Thermal)
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCheckout}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Checkout Next Patient
                  </button>
                </div>
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900 shadow-xs"
              >
                {formError}
              </div>
            )}

            {/* Main Checkout Form Grid */}
            <form onSubmit={handleCollectPayment} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT COLUMN: Patient Selection & Charges (7 cols) */}
              <div className="space-y-5 lg:col-span-7 xl:col-span-8">
                {/* Patient Search & Profile Card */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <IconUser className="h-5 w-5 text-emerald-800" />
                    <h2 className="text-base font-bold text-slate-900">Patient Identification</h2>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                      <IconSearch className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      aria-label="Search patient by Name, Mobile or Patient ID"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search patient by Name, Mobile or Patient ID (URN)..."
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 py-2.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-700"
                      >
                        <IconX className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Results */}
                  {searchQuery.trim().length >= 2 && (
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                      {isSearching ? (
                        <div className="p-3 text-center text-xs text-slate-500">Searching patients...</div>
                      ) : searchResults && searchResults.length > 0 ? (
                        searchResults.map((patient: PatientOut) => (
                          <button
                            key={patient.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(patient)
                              setSearchQuery('')
                            }}
                            className="w-full p-2.5 text-left text-xs hover:bg-emerald-50/60 cursor-pointer flex items-center justify-between transition-colors"
                          >
                            <div>
                              <div className="font-bold text-slate-900">{patient.full_name}</div>
                              <div className="font-mono text-xs text-emerald-800">{patient.urn}</div>
                            </div>
                            <div className="text-right text-xs text-slate-500 font-mono">
                              {patient.mobile}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="p-3 text-center text-xs text-slate-500">No matching patients found.</div>
                      )}
                    </div>
                  )}

                  {/* Selected Patient Card */}
                  {selectedPatient ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold">
                            <IconUser className="h-5 w-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{selectedPatient.full_name}</h4>
                            <span className="font-mono text-xs font-bold text-slate-600 block">
                              {selectedPatient.urn}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedPatient(null)}
                          className="text-xs font-semibold text-slate-500 hover:text-red-700 cursor-pointer"
                        >
                          Change
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200/70 pt-2 font-mono">
                        <span>
                          {selectedPatient.age_years} Y &bull;{' '}
                          {selectedPatient.gender === 'M' ? 'Male' : selectedPatient.gender === 'F' ? 'Female' : 'Other'}
                        </span>
                        <span>{selectedPatient.mobile}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                      Search above to select a patient, or click a patient from the Waiting Queue.
                    </div>
                  )}
                </section>

                {/* Service & Charge Selection */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <IconStethoscope className="h-5 w-5 text-emerald-800" />
                    <h2 className="text-base font-bold text-slate-900">Service Charges &amp; Fees</h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Service Type */}
                    <div>
                      <label htmlFor="billing-service-type" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Service Type *
                      </label>
                      <select
                        id="billing-service-type"
                        value={serviceType}
                        onChange={(e) => handleServiceChange(e.target.value as any)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[44px]"
                      >
                        <option value="opd_consultation">OPD Consultation Fee - ₹400.00</option>
                        <option value="follow_up">Clinical Follow-up Re-visit - ₹200.00</option>
                        <option value="physio_session">Physiotherapy Treatment Session - ₹500.00</option>
                        <option value="custom">Other / Custom Service Charge</option>
                      </select>
                    </div>

                    {/* Consulting Doctor */}
                    <div>
                      <label htmlFor="billing-doctor" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Consulting Doctor (Optional)
                      </label>
                      <select
                        id="billing-doctor"
                        value={selectedDoctorId}
                        onChange={(e) => handleDoctorChange(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[44px]"
                      >
                        <option value="">-- Clinic General OPD --</option>
                        {doctors?.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name_en} - {doc.qualification || 'Clinician'}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Amount in Rupees */}
                    <div className="sm:col-span-2">
                      <label htmlFor="billing-amount" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Payable Amount (₹ INR) *
                      </label>
                      <div className="relative max-w-xs">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 font-bold text-slate-500">
                          ₹
                        </div>
                        <input
                          id="billing-amount"
                          type="number"
                          step="0.01"
                          min="1"
                          required
                          value={amountRupees}
                          onChange={(e) => setAmountRupees(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3.5 py-2.5 text-base font-black text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[44px]"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* RIGHT COLUMN: Payment Mode & Issue Receipt (5 cols) */}
              <div className="space-y-5 lg:col-span-5 xl:col-span-4">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <IconRupee className="h-5 w-5 text-emerald-800" />
                    <h2 className="text-base font-bold text-slate-900">Payment Collection</h2>
                  </div>

                  {/* Payment Mode Selector */}
                  <div>
                    <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                      Payment Mode *
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {(['CASH', 'UPI', 'CARD'] as PaymentMethod[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPaymentMethod(mode)}
                          className={`rounded-xl border py-2.5 text-xs font-bold transition-all ${paymentMethod === mode
                              ? 'border-emerald-600 bg-[#124832] text-white shadow-xs'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes / Reference */}
                  <div>
                    <label htmlFor="billing-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                      Transaction Remarks (Optional)
                    </label>
                    <textarea
                      id="billing-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="UPI Ref ID, Cash Counter, or receipt note..."
                      className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none"
                    />
                  </div>

                  {/* Final Checkout Summary Box */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-emerald-900">
                      <span>Total Amount Payable:</span>
                      <span className="font-mono text-xl font-black text-emerald-950">
                        ₹{parseFloat(amountRupees || '0').toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-emerald-800 border-t border-emerald-200/80 pt-1.5 font-medium">
                      <span>Receipt Numbering:</span>
                      <span className="font-bold">Next Sequential (Gap-free)</span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={recordPaymentMutation.isPending || !selectedPatient}
                    className="w-full inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#124832] px-6 text-sm font-bold text-white shadow-xs hover:bg-[#0D3822] disabled:opacity-50 cursor-pointer"
                  >
                    <IconDeviceFloppy className="h-4 w-4" />
                    {recordPaymentMutation.isPending
                      ? 'Recording...'
                      : `Collect ₹${parseFloat(amountRupees || '0').toFixed(2)} & Issue Receipt`}
                  </button>
                </section>
              </div>
            </form>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: TODAY'S RECEIPTS & LEDGER                         */}
        {/* ======================================================== */}
        {activeTab === 'ledger' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Collections &amp; Receipts Ledger</h2>
                <p className="text-xs text-slate-500">
                  Audit-backed sequential receipts issued for consultations and packages.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  aria-label="Filter ledger receipts by receipt number, URN or name"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Filter by receipt #, URN or name..."
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none min-h-[38px]"
                />
                <select
                  aria-label="Filter receipts by payment status"
                  value={ledgerStatus}
                  onChange={(e) => setLedgerStatus(e.target.value as any)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none min-h-[38px]"
                >
                  <option value="all">All Receipts</option>
                  <option value="active">Active Only</option>
                  <option value="reversed">Reversed Only</option>
                </select>
              </div>
            </div>

            {/* Ledger Table */}
            {ledgerLoading ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading ledger receipts...</div>
            ) : !ledgerPayments || ledgerPayments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No payment receipts found matching filter.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3">Receipt #</th>
                      <th className="py-3 px-3">Date &amp; Time (IST)</th>
                      <th className="py-3 px-3">Patient</th>
                      <th className="py-3 px-3">Service / Plan</th>
                      <th className="py-3 px-3 text-right">Amount</th>
                      <th className="py-3 px-3 text-center">Mode</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {ledgerPayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-slate-900">{p.receipt_number}</td>
                        <td className="py-3 px-3 text-slate-600">{formatIst(p.created_at)}</td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{p.patient_name}</div>
                          <div className="font-mono text-xs text-slate-500">{p.patient_urn}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          {p.treatment_plan_name || p.notes || 'OPD Consultation'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-900">
                          {formatPaise(p.amount_paise)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {p.is_reversed ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                              Reversed
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setReprintPayment(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-2xs"
                          >
                            <IconPrinter className="h-3.5 w-3.5 text-slate-500" />
                            Print
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ======================================================== */}
        {/* TAB 3: OUTSTANDING PACKAGE DUES                          */}
        {/* ======================================================== */}
        {activeTab === 'dues' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Outstanding Package Dues Ledger</h2>
                <p className="text-xs text-slate-500">
                  Active physiotherapy packages with pending balances computed dynamically.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-800 block">
                    Total Outstanding
                  </span>
                  <span className="font-mono text-base font-black text-amber-950">
                    {formatPaise(totalOutstandingPaise)}
                  </span>
                </div>
                <input
                  type="text"
                  aria-label="Search outstanding dues by patient, URN, or package"
                  value={duesSearch}
                  onChange={(e) => setDuesSearch(e.target.value)}
                  placeholder="Search by patient, URN, or package..."
                  className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none min-h-[38px]"
                />
              </div>
            </div>

            {duesLoading ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading pending dues...</div>
            ) : filteredDues.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No active packages with pending dues found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3">Patient</th>
                      <th className="py-3 px-3">Package Details</th>
                      <th className="py-3 px-3 text-right">Agreed Fee</th>
                      <th className="py-3 px-3 text-right">Paid</th>
                      <th className="py-3 px-3 text-right">Balance Due</th>
                      <th className="py-3 px-3 text-center">Sessions</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredDues.map((due) => (
                      <tr key={due.treatment_plan_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{due.patient_name}</div>
                          <div className="font-mono text-xs text-slate-500">{due.patient_urn}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{due.plan_name}</div>
                          <div className="text-xs text-slate-500">{due.condition_diagnosis || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-medium text-slate-800">
                          {formatPaise(due.agreed_price_paise)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-800">
                          {formatPaise(due.paid_paise)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-red-700">
                          {formatPaise(due.balance_paise)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                            {due.completed_sessions} / {due.total_sessions}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setDueToCollect(due)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-900 cursor-pointer"
                          >
                            <IconRupee className="h-3.5 w-3.5" />
                            Collect Payment
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Modal for reprinting a receipt */}
        {reprintPayment && (
          <ReceiptDialog
            payment={reprintPayment}
            isReprint={true}
            onClose={() => setReprintPayment(null)}
          />
        )}

        {/* Modal for collecting due package payment */}
        {dueToCollect && (
          <PaymentModal
            isOpen={true}
            onClose={() => setDueToCollect(null)}
            patientId={dueToCollect.patient_id}
            patientName={dueToCollect.patient_name}
            patientUrn={dueToCollect.patient_urn}
            treatmentPlan={{
              id: dueToCollect.treatment_plan_id,
              patient_id: dueToCollect.patient_id,
              patient_urn: dueToCollect.patient_urn,
              patient_name: dueToCollect.patient_name,
              doctor_id: 0,
              doctor_name: '',
              encounter_id: null,
              plan_name: dueToCollect.plan_name,
              condition_diagnosis: dueToCollect.condition_diagnosis || '',
              referred_by: null,
              total_sessions: dueToCollect.total_sessions,
              completed_sessions: dueToCollect.completed_sessions,
              agreed_price_paise: dueToCollect.agreed_price_paise,
              status: 'ACTIVE',
              cancellation_reason: null,
              version_id: 1,
              created_at: '',
              updated_at: '',
            }}
            defaultAmountPaise={dueToCollect.balance_paise}
            onSuccess={(p) => {
              setRecordedPayment(p)
              setDueToCollect(null)
            }}
          />
        )}
      </div>
    </AppShell>
  )
}
export default ReceptionBillingPage
