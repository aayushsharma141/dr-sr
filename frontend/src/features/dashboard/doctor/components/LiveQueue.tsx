import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { DoctorQueueItem, DoctorQueueResponse } from '../dashboard-service'

interface LiveQueueProps {
  queue?: DoctorQueueResponse
  isLoading?: boolean
  isRefetching?: boolean
  onRefresh?: () => void
  activeTab?: 'all' | 'waiting' | 'in_consultation' | 'scheduled'
  onSelectTab?: (tab: 'all' | 'waiting' | 'in_consultation' | 'scheduled') => void
}

export function LiveQueue({
  queue,
  isLoading,
  isRefetching,
  onRefresh,
  activeTab = 'all',
  onSelectTab,
}: LiveQueueProps) {
  const navigate = useNavigate()
  const [filterVisitType, setFilterVisitType] = useState<string>('all')
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  const inConsultationList = queue?.in_consultation ?? []
  const waitingList = queue?.waiting ?? []
  const bookedList = queue?.booked ?? []

  // Counts
  const waitingCount = waitingList.length
  const inConsultCount = inConsultationList.length
  const scheduledCount = bookedList.length
  const allCount = waitingCount + inConsultCount + scheduledCount

  // Filter by selected tab
  let currentList: DoctorQueueItem[] = []
  if (activeTab === 'waiting') {
    currentList = waitingList
  } else if (activeTab === 'in_consultation') {
    currentList = inConsultationList
  } else if (activeTab === 'scheduled') {
    currentList = bookedList
  } else {
    // 'all' shows waiting and in_consultation first, then booked
    currentList = [...inConsultationList, ...waitingList, ...bookedList]
  }

  // Filter by visit type if set
  if (filterVisitType !== 'all') {
    currentList = currentList.filter(
      (item) => item.visit_kind?.toLowerCase() === filterVisitType.toLowerCase(),
    )
  }

  const formatWaitTime = (item: DoctorQueueItem) => {
    const rawTime = item.check_in_at || item.status_updated_at
    if (!rawTime) return '-'
    const timestamp = new Date(rawTime).getTime()
    if (isNaN(timestamp)) return '-'
    const diffMin = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
    return `${diffMin} min`
  }

  const handleStartConsult = (item: DoctorQueueItem) => {
    navigate(`/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}`)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-hidden flex flex-col">
      {/* Table Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            Live Queue ({currentList.length})
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </h2>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <svg
              className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin text-rose-700' : 'text-slate-400'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>

          <button
            type="button"
            onClick={() => navigate('/doctor/queue')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-200 bg-brand-50 text-xs font-semibold text-brand-800 hover:bg-brand-100 transition-colors cursor-pointer"
            title="Open clinical queue workstation with 3-Zone EMR & Kanban cards"
          >
            My Queue &rarr;
          </button>

          <select
            value={filterVisitType}
            onChange={(e) => setFilterVisitType(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-colors cursor-pointer outline-hidden focus:border-rose-500"
          >
            <option value="all">All Visits</option>
            <option value="walk_in">Walk-in</option>
            <option value="follow_up">Follow-up</option>
            <option value="referral">Referral</option>
          </select>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-5 pt-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
        <button
          type="button"
          onClick={() => onSelectTab?.('all')}
          className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 cursor-pointer ${
            activeTab === 'all'
              ? 'border-rose-700 text-rose-800 bg-white shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          All ({allCount})
        </button>
        <button
          type="button"
          onClick={() => onSelectTab?.('waiting')}
          className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 cursor-pointer ${
            activeTab === 'waiting'
              ? 'border-rose-700 text-rose-800 bg-white shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Waiting ({waitingCount})
        </button>
        <button
          type="button"
          onClick={() => onSelectTab?.('in_consultation')}
          className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 cursor-pointer ${
            activeTab === 'in_consultation'
              ? 'border-rose-700 text-rose-800 bg-white shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          In Consult ({inConsultCount})
        </button>
        <button
          type="button"
          onClick={() => onSelectTab?.('scheduled')}
          className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 cursor-pointer ${
            activeTab === 'scheduled'
              ? 'border-rose-700 text-rose-800 bg-white shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Scheduled ({scheduledCount})
        </button>
      </div>

      {/* Queue Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-2xs uppercase tracking-wider text-slate-400 font-bold">
              <th className="py-2.5 px-4 w-12 text-center">#</th>
              <th className="py-2.5 px-4">Patient Name</th>
              <th className="py-2.5 px-4">URN</th>
              <th className="py-2.5 px-4">Age / Gender</th>
              <th className="py-2.5 px-4">Visit Type</th>
              <th className="py-2.5 px-4">Wait Time</th>
              <th className="py-2.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="w-6 h-6 border-2 border-rose-700 border-t-transparent rounded-full animate-spin" />
                    <span>Loading queue...</span>
                  </div>
                </td>
              </tr>
            ) : currentList.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <svg
                      className="w-8 h-8 text-slate-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                      />
                    </svg>
                    <p className="font-semibold text-slate-600">No patients in this queue</p>
                    <p className="text-2xs text-slate-400">
                      Patients checked in by reception will appear here automatically.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              currentList.map((item, index) => {
                const isConsulting =
                  item.consultation_status === 'IN_CONSULTATION' ||
                  item.status === 'IN_CONSULTATION'
                const isWaiting =
                  item.consultation_status === 'WAITING' ||
                  item.status === 'ARRIVED' ||
                  item.status === 'CHECKED_IN' ||
                  item.status === 'WAITING'
                const isBooked =
                  item.status === 'BOOKED' ||
                  item.status === 'TO_ARRIVE' ||
                  item.status === 'REGISTERED'

                const tokenDisplay = item.token_number ?? index + 1
                const ageGender = `${item.patient_age}y / ${item.patient_gender}`

                const visitLabel =
                  item.visit_kind === 'NEW'
                    ? 'Walk-in'
                    : item.visit_kind === 'FOLLOW_UP'
                    ? 'Follow-up'
                    : 'Walk-in'

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      isConsulting ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    {/* 1. Token Circle */}
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-50 text-rose-800 font-bold border border-rose-200/80 text-xs">
                        {tokenDisplay}
                      </span>
                    </td>

                    {/* 2. Patient Name & Notes */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{item.patient_name}</div>
                      {item.notes ? (
                        <div className="text-2xs text-slate-500 line-clamp-1">{item.notes}</div>
                      ) : (
                        <div className="text-2xs text-slate-400 italic">General consultation</div>
                      )}
                    </td>

                    {/* 3. URN */}
                    <td className="py-3 px-4 font-mono text-2xs text-slate-600">
                      {item.patient_urn}
                    </td>

                    {/* 4. Age / Gender */}
                    <td className="py-3 px-4 text-slate-700">{ageGender}</td>

                    {/* 5. Visit Type Badge */}
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                        {visitLabel}
                      </span>
                    </td>

                    {/* 6. Wait Time */}
                    <td className="py-3 px-4 text-slate-600">
                      <div className="inline-flex items-center gap-1 text-2xs font-medium">
                        <svg
                          className="w-3.5 h-3.5 text-rose-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        {formatWaitTime(item)}
                      </div>
                    </td>

                    {/* 7. Context Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {isWaiting && (
                          <button
                            type="button"
                            onClick={() => handleStartConsult(item)}
                            className="bg-[#800020] hover:bg-[#68001a] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                          >
                            Start Consult
                          </button>
                        )}
                        {isConsulting && (
                          <button
                            type="button"
                            onClick={() => handleStartConsult(item)}
                            className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                          >
                            Continue Consult
                          </button>
                        )}
                        {isBooked && (
                          <span className="text-2xs font-medium text-slate-400 italic px-2">
                            Awaiting Check-in
                          </span>
                        )}

                        {/* Three dot actions */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenMenuId(openMenuId === item.id ? null : item.id)
                            }
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                            aria-label="More actions"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                            </svg>
                          </button>

                          {openMenuId === item.id && (
                            <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-30 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  navigate(`/reception/patients/${item.patient_id}`)
                                }}
                                className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                View Profile
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  navigate(`/reception/patients/${item.patient_id}`)
                                }}
                                className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                Clinical History
                              </button>
                            </div>
                          )}
                        </div>
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
  )
}
