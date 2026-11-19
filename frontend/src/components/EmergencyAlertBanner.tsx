import { useState } from 'react'
import { useDoctorAlerts } from '../api/alerts'
import { ApiError } from '../api/client'
import { useAcknowledgeAlert } from '../api/queries'
import { IconAlertTriangle } from './icons'

/**
 * Persistent emergency banner for the signed-in doctor (OD-22-09, owner decision Q7).
 *
 * Shows every unacknowledged EMERGENCY alert on the doctor's own consultations. There is no
 * dismiss control: the only exit is Acknowledge, and the row stays until the server confirms it.
 * The banner never blocks Call or the consultation. Acknowledged is shown only after the server
 * responds.
 */
export function EmergencyAlertBanner() {
  const { data: alerts = [], refetch } = useDoctorAlerts(true)
  const acknowledge = useAcknowledgeAlert()
  const [errors, setErrors] = useState<Record<number, string>>({})

  const handleAcknowledge = (id: number, versionId: number) => {
    setErrors((prev) => ({ ...prev, [id]: '' }))
    acknowledge.mutate(
      { id, body: { version_id: versionId } },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setErrors((prev) => ({ ...prev, [id]: 'This alert was already acknowledged.' }))
            void refetch()
            return
          }
          setErrors((prev) => ({
            ...prev,
            [id]: 'Could not record the acknowledgement. The alert is still open. Try again.',
          }))
        },
      },
    )
  }

  // The live region stays in the DOM so screen readers announce alerts as they arrive.
  return (
    <div aria-live="polite">
      {alerts.length > 0 && (
        <section
          aria-label="Emergency alerts"
          className="space-y-3 rounded-lg bg-red-600 p-4 text-white"
        >
          {alerts.map((item) => {
            const pending = acknowledge.isPending && acknowledge.variables?.id === item.id
            return (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 text-base font-bold">
                    <IconAlertTriangle className="h-4 w-4" aria-hidden="true" />
                    <span>
                      EMERGENCY · Token {item.token_number ?? '—'} · {item.patient_name}
                    </span>
                  </p>
                  {item.priority_reason && (
                    <p className="text-sm">{item.priority_reason}</p>
                  )}
                  {errors[item.id] && (
                    <p role="alert" className="text-sm font-semibold">
                      {errors[item.id]}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleAcknowledge(item.id, item.version_id)}
                  className="min-h-[44px] rounded-md bg-white px-4 text-sm font-bold text-red-700 disabled:opacity-70"
                >
                  {pending ? 'Recording…' : 'Acknowledge'}
                </button>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
