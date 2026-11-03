import { useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { hasReportedAllergies } from '../components/UnsavedChangesGuard'
import { useDoctorQueue, useMe } from '../api/queries'
import type { DoctorQueueItem } from '../api/types'

export function DoctorDashboard() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const { data: queue, isPending, isError, error, refetch } = useDoctorQueue()

  const handleStartConsultation = (item: DoctorQueueItem) => {
    navigate(`/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}`)
  }

  const waitingCount = queue?.waiting?.length || 0
  const bookedCount = queue?.booked?.length || 0
  const inConsultCount = queue?.in_consultation?.length || 0
  const completedCount = queue?.completed?.length || 0
  const totalActive = waitingCount + bookedCount + inConsultCount

  // Identify currently serving or next candidate patient
  const activeConsultation = queue?.in_consultation?.[0] || null
  const nextWaiting = !activeConsultation && queue?.waiting?.length ? queue.waiting[0] : null

  return (
    <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">
      <div className="space-y-6">
        {/* Welcome & Queue Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider text-rose-900">Doctor Clinical Station</span>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 mt-0.5">
              Doctor Consultation Queue
            </h2>
            <p className="text-xs text-neutral-600 mt-1">
              Live waiting room for Dr. {queue?.doctor_name || me?.full_name} ({queue?.queue_date || 'Today'})
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors min-h-[40px] focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
          >
            <svg className="w-4 h-4 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Queue
          </button>
        </div>

        {isPending ? (
          <div className="bg-white p-12 text-center text-neutral-600 rounded-xl border border-neutral-200" role="status">
            Loading today's consultation queue...
          </div>
        ) : isError ? (
          <div className="bg-white p-6 text-center text-red-700 rounded-xl border border-red-200" role="alert">
            Failed to load queue: {error.message}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Drittech-Inspired High-Visibility "NOW SERVING" Token Hero Banner */}
            <div className="rounded-xl border border-slate-900/10 bg-linear-to-r from-[#5D0B26] via-[#751233] to-[#8E1C3D] text-white p-6 shadow-md">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                {/* Left: Active Consultation Station */}
                <div className="lg:col-span-7 xl:col-span-8 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase bg-amber-400 text-amber-950 shadow-2xs">
                      {activeConsultation ? 'NOW SERVING' : 'DOCTOR STATION READY'}
                    </span>
                    <span className="text-xs font-semibold text-rose-100">
                      CONSULTATION ROOM 1 &bull; GENERAL OPD / PHYSIOTHERAPY
                    </span>
                  </div>

                  {activeConsultation ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 bg-white/10 rounded-xl p-4 sm:p-5 border border-white/15 backdrop-blur-xs">
                      <div className="flex items-start gap-4">
                        <div className="px-3.5 py-2.5 bg-amber-400 text-amber-950 rounded-xl font-mono text-center shrink-0 shadow-xs border border-amber-300">
                          <span className="block text-xs font-black uppercase tracking-wider">Token</span>
                          <span className="block font-black text-2xl sm:text-3xl leading-none">#{activeConsultation.token_number}</span>
                        </div>
                        <div>
                          <div className="flex items-baseline gap-2.5 flex-wrap">
                            <span className="font-extrabold text-xl sm:text-2xl text-white">
                              {activeConsultation.patient_name}
                            </span>
                            <span className="font-mono text-xs font-semibold text-rose-100">
                              ({activeConsultation.patient_urn})
                            </span>
                          </div>
                          <p className="text-xs text-rose-100 mt-1 font-medium">
                            Age: {activeConsultation.patient_age} yrs &bull; Gender: {activeConsultation.patient_gender === 'M' ? 'Male' : activeConsultation.patient_gender === 'F' ? 'Female' : 'Other'} &bull; Mobile: {activeConsultation.patient_mobile}
                          </p>
                          {activeConsultation.notes && (
                            <p className="text-xs text-amber-200 mt-1 font-semibold italic">
                              Intake: {activeConsultation.notes}
                            </p>
                          )}
                          {hasReportedAllergies(activeConsultation.patient_allergies) && (
                            <span className="inline-block mt-2 text-xs font-black text-red-950 bg-red-100 px-2.5 py-0.5 rounded border border-red-300">
                              ⚠️ Allergies: {activeConsultation.patient_allergies}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleStartConsultation(activeConsultation)}
                        className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-sm rounded-lg shadow-sm shrink-0 transition-colors cursor-pointer min-h-[44px] flex items-center justify-center gap-2"
                      >
                        Resume Clinical Notes &rarr;
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/10 rounded-xl p-5 border border-white/15">
                      <div>
                        <p className="text-sm font-bold text-white">
                          No consultation currently in progress.
                        </p>
                        <p className="text-xs text-rose-100 mt-0.5">
                          {waitingCount > 0
                            ? `${waitingCount} patient(s) waiting in reception. Review waiting list below to call next.`
                            : 'All checked-in patients have been served. Waiting room is clear.'}
                        </p>
                      </div>
                      {nextWaiting && (
                        <button
                          type="button"
                          onClick={() => handleStartConsultation(nextWaiting)}
                          className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs rounded-lg shadow-sm shrink-0 transition-colors cursor-pointer min-h-[40px]"
                        >
                          Call Next Token &rarr;
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Waiting Tokens Strip & Hospital Desk Info */}
                <div className="lg:col-span-5 xl:col-span-4 border-t lg:border-t-0 lg:border-l border-white/20 pt-4 lg:pt-0 lg:pl-6 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-extrabold tracking-wider uppercase text-amber-300">
                      UPCOMING QUEUE STATUS
                    </span>
                    <span className="text-xs font-mono text-rose-100 font-semibold">
                      {waitingCount} waiting
                    </span>
                  </div>

                  <p className="text-xs text-rose-100 font-medium">
                    Tokens are ordered sequentially by reception check-in time.
                  </p>

                  <div className="border-t border-white/15 pt-2 text-xs text-rose-100 flex justify-between items-center">
                    <span>Dr. {queue.doctor_name || me?.full_name}</span>
                    <span className="font-semibold text-amber-200">Kalyan Hospital OPD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Operational Metrics (4 Overview Cards) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-xs text-center">
                <span className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Total Active</span>
                <p className="text-2xl sm:text-3xl font-black text-neutral-900 mt-1">{totalActive}</p>
                <span className="text-xs text-neutral-500 font-medium">Patients booked or waiting</span>
              </div>
              <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-xs text-center">
                <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">Waiting Room</span>
                <p className="text-2xl sm:text-3xl font-black text-amber-950 mt-1">{waitingCount}</p>
                <span className="text-xs text-amber-800 font-medium">Checked-in at reception</span>
              </div>
              <div className="bg-purple-50/70 p-4 rounded-xl border border-purple-200 shadow-xs text-center">
                <span className="text-xs font-semibold text-purple-900 uppercase tracking-wider">In Consultation</span>
                <p className="text-2xl sm:text-3xl font-black text-purple-950 mt-1">{inConsultCount}</p>
                <span className="text-xs text-purple-800 font-medium">Active doctor stations</span>
              </div>
              <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-xs text-center">
                <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wider">Completed Today</span>
                <p className="text-2xl sm:text-3xl font-black text-emerald-950 mt-1">{completedCount}</p>
                <span className="text-xs text-emerald-800 font-medium">Consultations finalized</span>
              </div>
            </div>

            {/* 2-Column Landscape Layout: Queue on Left, Schedule & Done on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Waiting Room List (8 Cols) */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                <div className="bg-white rounded-xl border border-neutral-200 shadow-xs overflow-hidden">
                  <div className="px-5 py-4 border-b border-neutral-200 bg-amber-50/70 flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full bg-amber-500" />
                      <h3 className="font-bold text-base text-neutral-900">
                        Waiting Room ({waitingCount})
                      </h3>
                    </div>
                    <span className="text-xs text-amber-900 font-bold bg-amber-100/80 px-2.5 py-1 rounded-full">
                      Checked-in & Ready
                    </span>
                  </div>

                  {waitingCount === 0 ? (
                    <div className="p-10 text-center text-neutral-600 text-sm">
                      Waiting room is currently empty.
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-200">
                      {queue.waiting.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-neutral-50/80 transition-colors"
                        >
                          <div className="flex items-start gap-4">
                            <div className="px-3.5 py-2.5 bg-amber-100 text-amber-950 rounded-xl text-center font-mono font-black text-xl min-w-[64px] border border-amber-300 shadow-2xs">
                              #{item.token_number}
                            </div>
                            <div>
                              <div className="flex items-center gap-2.5">
                                <span className="font-bold text-neutral-900 text-base">{item.patient_name}</span>
                                <span className="text-xs font-mono font-semibold text-neutral-600">({item.patient_urn})</span>
                              </div>
                              <div className="text-xs text-neutral-700 mt-1 flex flex-wrap gap-2 font-medium">
                                <span>Age: {item.patient_age}</span>
                                <span>&bull;</span>
                                <span>Gender: {item.patient_gender}</span>
                                <span>&bull;</span>
                                <span>Mobile: {item.patient_mobile}</span>
                              </div>
                              {item.notes && (
                                <p className="text-xs text-neutral-600 mt-1.5 italic font-medium">
                                  Reception Remarks: {item.notes}
                                </p>
                              )}
                              {hasReportedAllergies(item.patient_allergies) && (
                                <span className="inline-block mt-1.5 text-xs font-bold text-red-800 bg-red-50 px-2.5 py-0.5 rounded border border-red-300">
                                  ⚠️ Allergies: {item.patient_allergies}
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleStartConsultation(item)}
                            className="px-4 py-2.5 bg-[#8E1C3D] hover:bg-[#721631] text-white rounded-lg font-semibold text-sm shadow-xs flex items-center gap-2 transition-colors min-h-[44px]"
                          >
                            Start Consultation &rarr;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Scheduled Bookings & Completed Consultations (4 Cols) */}
              <div className="lg:col-span-5 xl:col-span-4 space-y-6">
                {/* Upcoming / Scheduled (BOOKED Patients) */}
                <div className="bg-white rounded-xl border border-neutral-200 shadow-xs overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-neutral-200 bg-neutral-50/60 flex justify-between items-center">
                    <h3 className="font-bold text-sm text-neutral-900">
                      Scheduled Bookings ({bookedCount})
                    </h3>
                    <span className="text-xs text-neutral-600 font-medium">Awaiting arrival</span>
                  </div>

                  {bookedCount === 0 ? (
                    <div className="p-6 text-center text-neutral-600 text-xs">
                      No further booked appointments for today.
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100 max-h-72 overflow-y-auto">
                      {queue.booked.map((item) => (
                        <div key={item.id} className="p-3.5 flex justify-between items-center text-xs text-neutral-700">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono font-bold text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded">
                              #{item.token_number}
                            </span>
                            <span className="font-semibold text-neutral-900">{item.patient_name}</span>
                            <span className="font-mono text-neutral-600">({item.patient_urn})</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold text-xs">
                            Booked
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Completed Consultations */}
                {completedCount > 0 && (
                  <div className="bg-white rounded-xl border border-neutral-200 shadow-xs overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-neutral-200 bg-emerald-50/50 flex justify-between items-center">
                      <h3 className="font-bold text-sm text-neutral-900">
                        Completed Today ({completedCount})
                      </h3>
                    </div>
                    <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
                      {queue.completed.map((item) => (
                        <div key={item.id} className="p-3.5 flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono font-bold text-neutral-600">#{item.token_number}</span>
                            <span className="font-semibold text-neutral-900">{item.patient_name}</span>
                            <span className="font-mono text-neutral-600">({item.patient_urn})</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-xs">
                            &check; {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
