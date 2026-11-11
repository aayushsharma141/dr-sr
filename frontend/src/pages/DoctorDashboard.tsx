import { useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { DoctorDashboardUnfinishedCard } from '../components/DoctorDashboardUnfinishedCard'
import { useDoctorQueue, useMe } from '../api/queries'
import type { DoctorQueueItem } from '../api/types'
import { withDoctorTitle } from '../format'

export function DoctorDashboard() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const { data: queue, isPending, isError, error, refetch } = useDoctorQueue()
  const doctorName = queue?.doctor_name || me?.full_name

  const handleStartConsultation = (item: DoctorQueueItem) => {
    navigate(`/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}`)
  }

  return (
    <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">
      <div className="space-y-6">
        {/* Welcome & Queue Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg border border-neutral-200 shadow-xs">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">
              Doctor Dashboard
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              Live waiting room for {doctorName ? withDoctorTitle(doctorName) : 'the doctor'} ({queue?.queue_date || 'Today'})
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded text-xs font-semibold flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Queue
          </button>
        </div>

        {/* Doctor Incomplete Drafts Card (D-19-24, DWS-02) */}
        <DoctorDashboardUnfinishedCard />

        {isPending ? (
          <div className="bg-white p-12 text-center text-neutral-500 rounded-lg border">
            Loading today's consultation queue...
          </div>
        ) : isError ? (
          <div className="bg-white p-6 text-center text-red-700 rounded-lg border border-red-200">
            Failed to load queue: {error.message}
          </div>
        ) : (
          <>
            {/* Queue summary figures, derived from the loaded queue only */}
            <div className="admin-stagger grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Queue summary">
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 shadow-xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-900">Waiting</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950">{queue.waiting.length}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 shadow-xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">Scheduled</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-blue-950">{queue.booked.length}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 shadow-xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-900">Completed</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{queue.completed.length}</p>
              </div>
            </div>

            {/* Active / In-Consultation Patient Banner */}
            {queue.in_consultation.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 shadow-xs space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse"></span>
                  <span className="text-xs uppercase font-extrabold text-purple-900 tracking-wider">
                    Currently In Consultation
                  </span>
                </div>
                {queue.in_consultation.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded border border-purple-200 shadow-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 font-mono font-bold text-sm">
                          Token #{item.token_number}
                        </span>
                        <span className="font-bold text-lg text-neutral-900">{item.patient_name}</span>
                        <span className="text-xs font-mono text-neutral-500">({item.patient_urn})</span>
                      </div>
                      <p className="text-xs text-neutral-600 mt-1">
                        Age: {item.patient_age} | Gender: {item.patient_gender} | Mobile: {item.patient_mobile}
                      </p>
                      {item.patient_allergies && item.patient_allergies !== 'None reported' && (
                        <p className="text-xs font-semibold text-red-700 mt-1">
                          ⚠️ Allergies: {item.patient_allergies}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleStartConsultation(item)}
                      className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded font-medium text-sm shadow-xs"
                    >
                      Resume Clinical Notes &rarr;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Waiting Room (ARRIVED Patients) */}
            <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-200 bg-amber-50/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <h3 className="font-bold text-neutral-900">
                    Waiting Room ({queue.waiting.length})
                  </h3>
                </div>
                <span className="text-xs text-amber-800 font-semibold">Patients checked-in at reception</span>
              </div>

              {queue.waiting.length === 0 ? (
                <div className="p-8 text-center text-neutral-500 text-sm">
                  Waiting room is currently empty.
                </div>
              ) : (
                <div className="admin-stagger divide-y divide-neutral-200">
                  {queue.waiting.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-neutral-50 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="px-3 py-2 bg-amber-100 text-amber-950 rounded-lg text-center font-mono font-bold text-lg min-w-[60px]">
                          #{item.token_number}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-neutral-900 text-base">{item.patient_name}</span>
                            <span className="text-xs font-mono text-neutral-500">({item.patient_urn})</span>
                          </div>
                          <div className="text-xs text-neutral-600 mt-0.5 flex gap-2">
                            <span>Age: {item.patient_age}</span>
                            <span>&bull;</span>
                            <span>Gender: {item.patient_gender}</span>
                            <span>&bull;</span>
                            <span>Mobile: {item.patient_mobile}</span>
                          </div>
                          {item.notes && (
                            <p className="text-xs text-neutral-500 mt-1 italic">
                              Reception Remarks: {item.notes}
                            </p>
                          )}
                          {item.patient_allergies && item.patient_allergies !== 'None reported' && (
                            <span className="inline-block mt-1 text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                              ⚠️ Allergies: {item.patient_allergies}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleStartConsultation(item)}
                        className="px-4 py-2 bg-red-900 hover:bg-red-800 text-white rounded font-medium text-sm shadow-xs flex items-center gap-1.5"
                      >
                        Start Consultation &rarr;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming / Scheduled (BOOKED Patients) */}
            <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-200 flex justify-between items-center">
                <h3 className="font-bold text-neutral-900">
                  Scheduled Bookings ({queue.booked.length})
                </h3>
                <span className="text-xs text-neutral-500">Not yet arrived at reception</span>
              </div>

              {queue.booked.length === 0 ? (
                <div className="p-6 text-center text-neutral-500 text-sm">
                  No further booked appointments for today.
                </div>
              ) : (
                <div className="admin-stagger divide-y divide-neutral-100">
                  {queue.booked.map((item) => (
                    <div key={item.id} className="p-4 flex justify-between items-center text-sm text-neutral-600">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-neutral-700">#{item.token_number}</span>
                        <span className="font-medium text-neutral-900">{item.patient_name}</span>
                        <span className="text-xs font-mono text-neutral-600">({item.patient_urn})</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                        Booked
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Completed Consultations */}
            {queue.completed.length > 0 && (
              <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-200 flex justify-between items-center">
                  <h3 className="font-bold text-neutral-900">
                    Completed Consultations ({queue.completed.length})
                  </h3>
                </div>
                <div className="admin-stagger divide-y divide-neutral-100">
                  {queue.completed.map((item) => (
                    <div key={item.id} className="p-4 flex justify-between items-center text-sm">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-neutral-500">#{item.token_number}</span>
                        <span className="font-medium text-neutral-800">{item.patient_name}</span>
                        <span className="text-xs font-mono text-neutral-600">({item.patient_urn})</span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-700 font-semibold">
                        &check; {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
