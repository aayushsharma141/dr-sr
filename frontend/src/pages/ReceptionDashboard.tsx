import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { istToday } from '../format'
import {
  IconCheck,
  IconClock,
  IconStethoscope,
  IconUserPlus,
  IconRupee,
  IconAlertCircle,
  IconAlertTriangle,
  IconSearch,
  IconRefresh,
  IconPrinter,
  IconTicket,
  IconX,
  IconWallet,
} from '../components/icons'
import { Modal } from '../components/Modal'
import { useAppointments, useDoctors, useUpdateAppointmentStatus, useOverview } from '../api/queries'
import type { ReceptionOverview, Appointment, AppointmentStatus } from '../api/types'

function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100).toLocaleString('en-IN')
  return `₹${rupees}`
}

function getElapsedMinutes(isoString: string): number {
  try {
    const then = new Date(isoString).getTime()
    const now = Date.now()
    return Math.max(0, Math.floor((now - then) / 60000))
  } catch {
    return 0
  }
}

interface ReceptionDashboardProps {
  overview: ReceptionOverview
}

export function ReceptionDashboard({ overview: initialOverview }: ReceptionDashboardProps) {
  const navigate = useNavigate()
  const todayStr = useMemo(() => istToday(), [])

  // Live polling for appointments queue (every 10s) and overview (every 30s)
  const {
    data: appointmentsData,
    isLoading: queueLoading,
    refetch: refetchQueue,
  } = useAppointments({ appointment_date: todayStr })

  const { data: liveOverview, refetch: refetchOverview } = useOverview<ReceptionOverview>('reception')
  const overview = liveOverview || initialOverview

  const { data: doctors } = useDoctors(false)
  const updateStatusMutation = useUpdateAppointmentStatus()

  // State controls
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ARRIVED' | 'IN_CONSULTATION' | 'DONE' | 'BOOKED'>('ALL')
  const [doctorFilter, setDoctorFilter] = useState<number | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyDelayed, setOnlyDelayed] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Modals state
  const [cancellingAppt, setCancellingAppt] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [printTokenAppt, setPrintTokenAppt] = useState<Appointment | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)

  // Track last refresh time
  useEffect(() => {
    if (appointmentsData) {
      setLastUpdated(new Date())
    }
  }, [appointmentsData])

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([refetchQueue(), refetchOverview()])
    setLastUpdated(new Date())
    setTimeout(() => setIsRefreshing(false), 400)
  }

  // All appointments for today
  const allAppointments = useMemo(() => {
    return appointmentsData?.appointments ?? []
  }, [appointmentsData])

  // Count by status from live appointments
  const waitingAppts = useMemo(
    () => allAppointments.filter((a) => a.status === 'ARRIVED'),
    [allAppointments],
  )
  const inConsultationAppts = useMemo(
    () => allAppointments.filter((a) => a.status === 'IN_CONSULTATION'),
    [allAppointments],
  )
  const doneAppts = useMemo(
    () => allAppointments.filter((a) => a.status === 'DONE'),
    [allAppointments],
  )
  const bookedAppts = useMemo(
    () => allAppointments.filter((a) => a.status === 'BOOKED'),
    [allAppointments],
  )

  // Delayed appointments (>30 minutes in ARRIVED state)
  const delayedAppts = useMemo(() => {
    return waitingAppts.filter((a) => {
      const ts = a.status_updated_at || a.check_in_at || a.created_at
      return getElapsedMinutes(ts) >= 30
    })
  }, [waitingAppts])

  // Filtered queue records
  const filteredQueue = useMemo(() => {
    return allAppointments.filter((appt) => {
      // Delay filter toggle
      if (onlyDelayed) {
        if (appt.status !== 'ARRIVED') return false
        const ts = appt.status_updated_at || appt.check_in_at || appt.created_at
        if (getElapsedMinutes(ts) < 30) return false
      } else if (statusFilter !== 'ALL' && appt.status !== statusFilter) {
        return false
      }

      // Doctor filter
      if (doctorFilter !== 'ALL' && appt.doctor_id !== doctorFilter) {
        return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = appt.patient_name.toLowerCase().includes(q)
        const matchUrn = appt.patient_urn.toLowerCase().includes(q)
        const matchMobile = appt.patient_mobile ? appt.patient_mobile.includes(q) : false
        const matchToken = String(appt.token_number).includes(q)
        if (!matchName && !matchUrn && !matchMobile && !matchToken) {
          return false
        }
      }

      return true
    })
  }, [allAppointments, statusFilter, doctorFilter, searchQuery, onlyDelayed])

  // Check in a booked appointment
  const handleCheckIn = async (appt: Appointment) => {
    setConflictError(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: appt.id,
        body: {
          status: 'ARRIVED' as AppointmentStatus,
          version_id: appt.version_id,
        },
      })
    } catch (err: unknown) {
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to check in patient.')
      }
    }
  }

  // Cancel an appointment
  const handleConfirmCancel = async () => {
    if (!cancellingAppt || !cancelReason.trim()) return
    setConflictError(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: cancellingAppt.id,
        body: {
          status: 'CANCELLED' as AppointmentStatus,
          version_id: cancellingAppt.version_id,
          cancellation_reason: cancelReason.trim(),
        },
      })
      setCancellingAppt(null)
      setCancelReason('')
    } catch (err: unknown) {
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to cancel appointment.')
      }
    }
  }

  // Collection totals
  const grossPaise = overview.collections_today?.gross_paise ?? 0
  const reversedPaise = overview.collections_today?.reversed_paise ?? 0
  const netPaise = Math.max(0, grossPaise - reversedPaise)

  return (
    <div className="w-full space-y-6 pb-12">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
              Reception Dashboard
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
              LAN (Offline)
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Front Desk & Reception Command Center — live OPD queue, doctor room allocation & payment collection
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-right hidden sm:block mr-2">
            <p className="text-xs font-medium text-neutral-500">
              Last updated: {lastUpdated.toLocaleTimeString('en-IN')}
            </p>
            <p className="text-xs text-neutral-500">10s live queue sync</p>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            title="Refresh dashboard data"
            className="p-2 border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
          >
            <IconRefresh size={18} className={isRefreshing ? 'animate-spin text-emerald-700' : ''} />
          </button>

          <Link
            to="/reception/patients/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#5D0B26] hover:bg-[#48081d] text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
          >
            <IconUserPlus size={16} />
            + New Patient
          </Link>

          <Link
            to="/reception/tokens"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
          >
            <IconTicket size={16} />
            Generate Token
          </Link>

          <Link
            to="/reception/billing"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
          >
            <IconWallet size={16} />
            Counter Checkout
          </Link>
        </div>
      </div>

      {conflictError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg flex items-center justify-between">
          <span>{conflictError}</span>
          <button
            type="button"
            onClick={() => setConflictError(null)}
            className="text-red-700 hover:text-red-900 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Area A: 6 Top-Level Operational KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Card 1: Today's Registrations */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('ALL')
            setOnlyDelayed(false)
          }}
          className="text-left bg-white p-4 rounded-xl border border-neutral-200 hover:border-neutral-400 transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Registrations</span>
            <span className="p-1.5 rounded-lg bg-sky-50 text-sky-700 group-hover:scale-105 transition-transform">
              <IconUserPlus size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-neutral-900">
            {overview.registrations_today ?? allAppointments.length}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Walk-in + booked</p>
        </button>

        {/* Card 2: Waiting Patients */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('ARRIVED')
            setOnlyDelayed(false)
          }}
          className={`text-left p-4 rounded-xl border transition-all shadow-2xs hover:shadow-xs group cursor-pointer ${statusFilter === 'ARRIVED' && !onlyDelayed
              ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-400/20'
              : 'bg-white border-neutral-200 hover:border-amber-300'
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Waiting</span>
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-800 group-hover:scale-105 transition-transform">
              <IconClock size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-900">
            {waitingAppts.length}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Awaiting consultation</p>
        </button>

        {/* Card 3: In Consultation */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('IN_CONSULTATION')
            setOnlyDelayed(false)
          }}
          className={`text-left p-4 rounded-xl border transition-all shadow-2xs hover:shadow-xs group cursor-pointer ${statusFilter === 'IN_CONSULTATION'
              ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-400/20'
              : 'bg-white border-neutral-200 hover:border-indigo-300'
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">In Cabin</span>
            <span className="p-1.5 rounded-lg bg-indigo-100 text-indigo-800 group-hover:scale-105 transition-transform">
              <IconStethoscope size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-900">
            {inConsultationAppts.length}
          </div>
          <p className="text-xs text-neutral-500 mt-1">With doctors right now</p>
        </button>

        {/* Card 4: Completed */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('DONE')
            setOnlyDelayed(false)
          }}
          className={`text-left p-4 rounded-xl border transition-all shadow-2xs hover:shadow-xs group cursor-pointer ${statusFilter === 'DONE'
              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-400/20'
              : 'bg-white border-neutral-200 hover:border-emerald-300'
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Completed</span>
            <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 group-hover:scale-105 transition-transform">
              <IconCheck size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-900">
            {doneAppts.length}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Ready for checkout</p>
        </button>

        {/* Card 5: Payment Pending */}
        <button
          type="button"
          onClick={() => navigate('/reception/billing?tab=dues')}
          className="text-left bg-white p-4 rounded-xl border border-neutral-200 hover:border-rose-300 transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Dues Pending</span>
            <span className="p-1.5 rounded-lg bg-rose-100 text-rose-800 group-hover:scale-105 transition-transform">
              <IconAlertCircle size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-900">
            {formatPaise(overview.outstanding_dues_paise ?? 0)}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Outstanding balances</p>
        </button>

        {/* Card 6: Today's Collection */}
        <button
          type="button"
          onClick={() => navigate('/reception/billing?tab=ledger')}
          className="text-left bg-white p-4 rounded-xl border border-neutral-200 hover:border-teal-300 transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Collection</span>
            <span className="p-1.5 rounded-lg bg-teal-100 text-teal-800 group-hover:scale-105 transition-transform">
              <IconRupee size={16} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-teal-900">
            {formatPaise(netPaise)}
          </div>
          <p className="text-xs text-neutral-500 mt-1">Net payments today</p>
        </button>
      </div>

      {/* 3. Area E: Alerts & Exceptions ("Needs Attention") */}
      {(delayedAppts.length > 0 || (overview.outstanding_dues_paise ?? 0) > 0 || bookedAppts.length > 0) && (
        <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={18} className="text-amber-800 shrink-0" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-950">
              Needs Attention ({delayedAppts.length + (bookedAppts.length > 0 ? 1 : 0) + ((overview.outstanding_dues_paise ?? 0) > 0 ? 1 : 0)})
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {delayedAppts.length > 0 && (
              <div className="p-3 bg-white rounded-lg border border-amber-300 flex items-center justify-between shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-amber-900">
                    {delayedAppts.length} patient(s) waiting over 30 minutes
                  </p>
                  <p className="text-xs text-neutral-500">Check cabin delays</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOnlyDelayed(true)
                    setStatusFilter('ARRIVED')
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 rounded transition-colors"
                >
                  View
                </button>
              </div>
            )}

            {(overview.outstanding_dues_paise ?? 0) > 0 && (
              <div className="p-3 bg-white rounded-lg border border-rose-200 flex items-center justify-between shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-rose-900">
                    {formatPaise(overview.outstanding_dues_paise ?? 0)} pending dues
                  </p>
                  <p className="text-xs text-neutral-500">Payment follow-up required</p>
                </div>
                <Link
                  to="/reception/billing?tab=dues"
                  className="px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-900 hover:bg-rose-200 rounded transition-colors"
                >
                  Review
                </Link>
              </div>
            )}

            {bookedAppts.length > 0 && (
              <div className="p-3 bg-white rounded-lg border border-sky-200 flex items-center justify-between shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-sky-900">
                    {bookedAppts.length} booked patient(s) not checked in
                  </p>
                  <p className="text-xs text-neutral-500">Awaiting arrival at desk</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('BOOKED')
                    setOnlyDelayed(false)
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-sky-100 text-sky-900 hover:bg-sky-200 rounded transition-colors"
                >
                  Filter
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Main 2-Column Responsive Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Area B: Live OPD Queue */}
        <div className="xl:col-span-8 bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden">
          {/* Table Header & Controls */}
          <div className="p-5 border-b border-neutral-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-bold text-neutral-900">Live OPD Queue</h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  Live data
                </span>
                <span className="text-xs text-neutral-500 hidden md:inline">
                  {filteredQueue.length} of {allAppointments.length} patients
                </span>
              </div>

              {/* Doctor filter dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="reception-doc-filter" className="text-xs font-medium text-neutral-600">
                  Doctor:
                </label>
                <select
                  id="reception-doc-filter"
                  aria-label="Filter by doctor"
                  value={doctorFilter}
                  onChange={(e) => setDoctorFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                  className="text-xs border border-neutral-300 rounded-lg px-2.5 py-1.5 bg-neutral-50 font-medium text-neutral-800 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                >
                  <option value="ALL">All Doctors</option>
                  {(doctors || []).map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name_en}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Status Filter Tabs & Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'ALL', label: 'All', count: allAppointments.length },
                    { id: 'ARRIVED', label: 'Waiting', count: waitingAppts.length },
                    { id: 'IN_CONSULTATION', label: 'In Cabin', count: inConsultationAppts.length },
                    { id: 'DONE', label: 'Completed', count: doneAppts.length },
                    { id: 'BOOKED', label: 'Booked', count: bookedAppts.length },
                  ] as const
                ).map((tab) => {
                  const active = statusFilter === tab.id && !onlyDelayed
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setStatusFilter(tab.id)
                        setOnlyDelayed(false)
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${active
                          ? 'bg-neutral-900 text-white shadow-2xs'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-xs ${active ? 'bg-white/20 text-white' : 'bg-neutral-200/80 text-neutral-700'
                          }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  )
                })}

                {onlyDelayed && (
                  <button
                    type="button"
                    onClick={() => setOnlyDelayed(false)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-600 text-white flex items-center gap-1"
                  >
                    <span>Delayed Only ({delayedAppts.length})</span>
                    <IconX size={14} />
                  </button>
                )}
              </div>

              {/* Search Bar */}
              <div className="relative min-w-[220px] sm:w-64">
                <IconSearch size={15} className="absolute left-2.5 top-2.5 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Search name, URN, mobile, token..."
                  aria-label="Search patient queue"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-700 bg-neutral-50/50 placeholder:text-neutral-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2 text-neutral-500 hover:text-neutral-700"
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table Data */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 text-neutral-600 uppercase text-xs font-semibold border-b border-neutral-200">
                  <th className="py-3 px-4 w-16 text-center">Token</th>
                  <th className="py-3 px-4">Patient & Demographics</th>
                  <th className="py-3 px-4">Doctor / Dept</th>
                  <th className="py-3 px-4">Arrival / Waiting</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 text-xs">
                {queueLoading && allAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-neutral-500">
                      Loading live OPD queue...
                    </td>
                  </tr>
                ) : filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="max-w-xs mx-auto space-y-2">
                        <p className="text-sm font-semibold text-neutral-700">No patients found</p>
                        <p className="text-xs text-neutral-500">
                          {searchQuery || statusFilter !== 'ALL' || onlyDelayed
                            ? 'No records match your active filters or search terms.'
                            : 'No patient appointments scheduled for today yet.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map((appt) => {
                    const elapsed = getElapsedMinutes(appt.status_updated_at || appt.check_in_at || appt.created_at)
                    const isDelayed = appt.status === 'ARRIVED' && elapsed >= 30

                    return (
                      <tr key={appt.id} className="hover:bg-neutral-50/80 transition-colors">
                        {/* Token # */}
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-block px-2.5 py-1 rounded-md text-sm font-black bg-neutral-900 text-white font-mono shadow-2xs">
                            #{String(appt.token_number).padStart(2, '0')}
                          </span>
                        </td>

                        {/* Patient */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <Link
                              to={`/reception/patients/${appt.patient_id}`}
                              className="font-bold text-neutral-900 hover:text-emerald-800 transition-colors"
                            >
                              {appt.patient_name}
                            </Link>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500 font-mono">
                              <span>{appt.patient_urn}</span>
                              {appt.patient_mobile && (
                                <>
                                  <span>•</span>
                                  <span>{appt.patient_mobile}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Doctor */}
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-neutral-800">{appt.doctor_name_en}</div>
                          <span className="text-xs text-neutral-500 uppercase tracking-wider">Physiotherapy</span>
                        </td>

                        {/* Arrival / Waiting time */}
                        <td className="py-3.5 px-4">
                          {appt.status === 'ARRIVED' ? (
                            <div>
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${isDelayed ? 'text-amber-800 font-bold' : 'text-neutral-700'
                                  }`}
                              >
                                {isDelayed && <IconAlertCircle size={13} className="text-amber-700" />}
                                {elapsed} min waiting
                              </span>
                              <p className="text-xs text-neutral-500">
                                In: {new Date(appt.status_updated_at || appt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          ) : appt.status === 'IN_CONSULTATION' ? (
                            <span className="text-indigo-800 font-medium text-xs">In consultation</span>
                          ) : appt.status === 'DONE' ? (
                            <span className="text-emerald-800 font-medium text-xs">Consulted</span>
                          ) : (
                            <span className="text-neutral-500 text-xs">Not arrived</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          {appt.status === 'ARRIVED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
                              Waiting
                            </span>
                          ) : appt.status === 'IN_CONSULTATION' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-900 border border-indigo-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                              In Cabin
                            </span>
                          ) : appt.status === 'DONE' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200">
                              <IconCheck size={13} />
                              Completed
                            </span>
                          ) : appt.status === 'BOOKED' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200">
                              Booked
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-500">
                              {appt.status}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Check-in for Booked */}
                            {appt.status === 'BOOKED' && (
                              <button
                                type="button"
                                onClick={() => handleCheckIn(appt)}
                                disabled={updateStatusMutation.isPending}
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-bold transition-colors shadow-2xs"
                              >
                                Check In
                              </button>
                            )}

                            {/* Proceed to Billing for Done */}
                            {appt.status === 'DONE' && (
                              <Link
                                to={`/reception/billing?patient_id=${appt.patient_id}&appointment_id=${appt.id}`}
                                className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-xs font-bold transition-colors shadow-2xs"
                              >
                                Billing →
                              </Link>
                            )}

                            {/* Print Token Ticket */}
                            <button
                              type="button"
                              onClick={() => setPrintTokenAppt(appt)}
                              title="Print token slip"
                              className="p-1 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded"
                            >
                              <IconPrinter size={15} />
                            </button>

                            {/* Cancel Option (for active or booked) */}
                            {(appt.status === 'BOOKED' || appt.status === 'ARRIVED') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingAppt(appt)
                                  setCancelReason('')
                                }}
                                title="Cancel appointment"
                                className="p-1 text-rose-500 hover:text-rose-800 hover:bg-rose-50 rounded"
                              >
                                <IconX size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (4 cols): Area C: Doctor Availability & Area D: Visualizations */}
        <div className="xl:col-span-4 space-y-6">
          {/* Area C: Doctor Availability and Workload */}
          <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-neutral-900 tracking-tight">Doctor Workload</h2>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Live Status
              </span>
            </div>

            <div className="space-y-3">
              {(overview.doctors_today && overview.doctors_today.length > 0
                ? overview.doctors_today
                : (doctors || []).map((d) => ({
                  doctor_id: d.id,
                  name: d.name_en,
                  appointments_today: allAppointments.filter((a) => a.doctor_id === d.id).length,
                  waiting: allAppointments.filter((a) => a.doctor_id === d.id && a.status === 'ARRIVED').length,
                  arrived_waiting: allAppointments.filter((a) => a.doctor_id === d.id && a.status === 'ARRIVED').length,
                  in_consultation: allAppointments.filter((a) => a.doctor_id === d.id && a.status === 'IN_CONSULTATION').length,
                  done: allAppointments.filter((a) => a.doctor_id === d.id && a.status === 'DONE').length,
                  department: d.qualification || 'Physiotherapy',
                  next_token: allAppointments.find((a) => a.doctor_id === d.id && a.status === 'ARRIVED')?.token_number ?? null,
                }))
              ).map((doc) => (
                <div
                  key={doc.doctor_id}
                  onClick={() => setDoctorFilter(doc.doctor_id)}
                  className={`p-3.5 rounded-lg border transition-all cursor-pointer ${doctorFilter === doc.doctor_id
                      ? 'border-emerald-600 bg-emerald-50/50 shadow-2xs'
                      : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/50'
                    }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                        <h4 className="text-xs font-bold text-neutral-900">{doc.name}</h4>
                      </div>
                      <p className="text-xs text-neutral-500 mt-0.5">{doc.department || 'Physiotherapy'}</p>
                    </div>

                    <span className="px-2 py-0.5 bg-neutral-900 text-white rounded text-xs font-mono font-bold">
                      Next: #{doc.next_token ? String(doc.next_token).padStart(2, '0') : '—'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-neutral-100 text-center">
                    <div className="bg-amber-50/60 p-1.5 rounded">
                      <span className="block text-xs font-bold text-amber-900">
                        {doc.arrived_waiting !== undefined ? doc.arrived_waiting : doc.waiting}
                      </span>
                      <span className="text-xs text-amber-700">Waiting</span>
                    </div>

                    <div className="bg-indigo-50/60 p-1.5 rounded">
                      <span className="block text-xs font-bold text-indigo-900">{doc.in_consultation}</span>
                      <span className="text-xs text-indigo-700">In Cabin</span>
                    </div>

                    <div className="bg-emerald-50/60 p-1.5 rounded">
                      <span className="block text-xs font-bold text-emerald-900">{doc.done}</span>
                      <span className="text-xs text-emerald-700">Done</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Area D: Patient Flow Distribution & Collection Trend */}
          <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-2xs space-y-5">
            {/* 1. Patient Flow Today */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                  Patient Flow Today
                </h3>
                <span className="text-xs font-bold text-neutral-900">{allAppointments.length} total</span>
              </div>

              {/* Segmented Progress Bar */}
              <div className="h-3 w-full bg-neutral-100 rounded-full overflow-hidden flex">
                {allAppointments.length > 0 ? (
                  <>
                    <div
                      style={{ width: `${(waitingAppts.length / allAppointments.length) * 100}%` }}
                      className="bg-amber-500 transition-all duration-300"
                      title={`Waiting: ${waitingAppts.length}`}
                    />
                    <div
                      style={{ width: `${(inConsultationAppts.length / allAppointments.length) * 100}%` }}
                      className="bg-indigo-600 transition-all duration-300"
                      title={`In Consultation: ${inConsultationAppts.length}`}
                    />
                    <div
                      style={{ width: `${(doneAppts.length / allAppointments.length) * 100}%` }}
                      className="bg-emerald-600 transition-all duration-300"
                      title={`Completed: ${doneAppts.length}`}
                    />
                    <div
                      style={{ width: `${(bookedAppts.length / allAppointments.length) * 100}%` }}
                      className="bg-neutral-400 transition-all duration-300"
                      title={`Booked: ${bookedAppts.length}`}
                    />
                  </>
                ) : (
                  <div className="w-full bg-neutral-200" />
                )}
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-neutral-600">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span>Waiting: <strong>{waitingAppts.length}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
                  <span>In Cabin: <strong>{inConsultationAppts.length}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                  <span>Completed: <strong>{doneAppts.length}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-neutral-400 shrink-0" />
                  <span>Booked: <strong>{bookedAppts.length}</strong></span>
                </div>
              </div>
            </div>

            {/* 2. Collection Hourly Trend */}
            <div className="pt-4 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                  Hourly Collections
                </h3>
                <span className="text-xs font-bold text-teal-800">{formatPaise(netPaise)}</span>
              </div>

              {/* Mini SVG Hourly Column Chart */}
              <div className="h-24 w-full flex items-end justify-between gap-1 pt-3 pb-1">
                {overview.hourly_collections && overview.hourly_collections.length > 0 ? (
                  overview.hourly_collections.map((pt) => {
                    const maxVal = Math.max(...overview.hourly_collections!.map((p) => p.amount_paise), 10000)
                    const heightPercent = Math.min(100, Math.max(10, Math.round((pt.amount_paise / maxVal) * 85)))
                    return (
                      <div key={pt.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className={`w-full rounded-t transition-all ${pt.amount_paise > 0 ? 'bg-teal-600 group-hover:bg-teal-700' : 'bg-neutral-200'
                            }`}
                        />
                        <span className="text-xs text-neutral-500 font-mono">
                          {pt.hour.split(':')[0]}
                        </span>

                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                          <div className="bg-neutral-900 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap shadow-sm">
                            {pt.hour}: {formatPaise(pt.amount_paise)} ({pt.count})
                          </div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="w-full text-center text-xs text-neutral-500 py-6">
                    No payment collection transactions recorded yet today
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Cancellation Reason Modal */}
      {cancellingAppt && (
        <Modal
          open
          variant="destructive"
          title="Cancel Patient Appointment"
          onClose={() => setCancellingAppt(null)}
          busy={updateStatusMutation.isPending}
          className="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-xs text-neutral-600">
              Provide a valid operational cancellation reason for Token #{cancellingAppt.token_number} (
              <strong>{cancellingAppt.patient_name}</strong>).
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700">Quick Reason Select:</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Patient requested reschedule',
                  'Doctor emergency surgery',
                  'Patient did not report',
                  'Duplicate booking entry',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCancelReason(preset)}
                    className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded border border-neutral-300"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              data-autofocus
              aria-label="Cancellation reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Detailed reason for cancellation..."
              rows={3}
              required
              className="w-full p-2.5 border border-neutral-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-red-800"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => setCancellingAppt(null)}
                className="px-3.5 py-1.5 border border-neutral-300 rounded-lg text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={!cancelReason.trim() || updateStatusMutation.isPending}
                onClick={handleConfirmCancel}
                className="px-3.5 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded-lg text-xs font-bold disabled:opacity-50 transition-colors shadow-2xs"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 6. Token Slip Print Preview Modal */}
      {printTokenAppt && (
        <Modal
          open
          variant="info"
          title="Print Token Slip"
          onClose={() => setPrintTokenAppt(null)}
          className="max-w-sm"
        >
          <div className="space-y-4">
            <div className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-200 text-center space-y-2 font-mono">
              <p className="text-xs font-bold text-neutral-600 uppercase tracking-wider">Kalyan Hospital</p>
              <p className="text-xs text-neutral-500">Physiotherapy Department</p>

              <div className="py-2">
                <span className="text-xs text-neutral-500 uppercase">Token No</span>
                <div className="text-4xl font-black text-neutral-900 tracking-tight">
                  P-{String(printTokenAppt.token_number).padStart(3, '0')}
                </div>
              </div>

              <div className="border-t border-dashed border-neutral-300 pt-2 text-left space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Patient:</span>
                  <span className="font-bold text-neutral-900">{printTokenAppt.patient_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">URN:</span>
                  <span className="text-neutral-700">{printTokenAppt.patient_urn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Doctor:</span>
                  <span className="text-neutral-900 font-semibold">{printTokenAppt.doctor_name_en}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Date:</span>
                  <span className="text-neutral-700">{printTokenAppt.appointment_date}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPrintTokenAppt(null)}
                className="px-3.5 py-1.5 border border-neutral-300 rounded-lg text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#5D0B26] hover:bg-[#48081d] text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
              >
                <IconPrinter size={15} />
                Print Slip
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

