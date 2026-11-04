import { useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useSecurityPolicy, useUpdateSecurityPolicy } from '../../api/queries'
import type { SecurityPolicyField, SecurityPolicyOut } from '../../api/types'
import { ConflictBanner } from '../../components/ConflictBanner'
import { InlineAlert } from '../../components/InlineAlert'
import { Modal } from '../../components/Modal'

// Admin module 09. The server only accepts tighter values than its installed baseline, so the
// form shows the allowed range for each field and the server re-checks every value.

const FIELDS: { key: SecurityPolicyField; label: string; unit: string }[] = [
  { key: 'session_idle_minutes', label: 'Sign out after inactivity', unit: 'minutes' },
  { key: 'session_absolute_hours', label: 'Maximum session length', unit: 'hours' },
  { key: 'lockout_threshold', label: 'Failed sign-ins before lockout', unit: 'attempts' },
  { key: 'lockout_minutes', label: 'Lockout duration', unit: 'minutes' },
  { key: 'password_min_length', label: 'Minimum password length', unit: 'characters' },
]

const REASON_MIN_LENGTH = 10
const REASON_MAX_LENGTH = 500

const INPUT =
  'mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 min-h-11 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'

type Values = Record<SecurityPolicyField, string>

function toValues(policy: SecurityPolicyOut): Values {
  return {
    session_idle_minutes: String(policy.session_idle_minutes),
    session_absolute_hours: String(policy.session_absolute_hours),
    lockout_threshold: String(policy.lockout_threshold),
    lockout_minutes: String(policy.lockout_minutes),
    password_min_length: String(policy.password_min_length),
  }
}

export function SecurityPolicyEditor({ policy, onClose }: { policy: SecurityPolicyOut; onClose: () => void }) {
  const { refetch, isFetching } = useSecurityPolicy()
  const update = useUpdateSecurityPolicy()
  const [values, setValues] = useState<Values>(() => toValues(policy))
  const [versionId, setVersionId] = useState(policy.version_id)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const outOfRange = FIELDS.filter(({ key }) => {
    const value = Number(values[key])
    const { minimum, maximum } = policy.limits[key]
    return !Number.isInteger(value) || value < minimum || value > maximum
  })
  const reasonOk = reason.trim().length >= REASON_MIN_LENGTH
  const canSave = outOfRange.length === 0 && reasonOk && !update.isPending

  const reload = async () => {
    const { data } = await refetch()
    if (data) {
      setValues(toValues(data))
      setVersionId(data.version_id)
      setConflict(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await update.mutateAsync({
        version_id: versionId,
        session_idle_minutes: Number(values.session_idle_minutes),
        session_absolute_hours: Number(values.session_absolute_hours),
        lockout_threshold: Number(values.lockout_threshold),
        lockout_minutes: Number(values.lockout_minutes),
        password_min_length: Number(values.password_min_length),
        reason: reason.trim(),
      })
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
      } else {
        setError(err instanceof Error ? err.message : 'Could not save the security policy.')
      }
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      variant="warning"
      title="Tighten security policy"
      description="Saved values apply to everyone on their next action, including people already signed in."
      busy={update.isPending}
      className="max-w-lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {conflict && <ConflictBanner onReload={() => void reload()} isReloading={isFetching} />}
        {error && (
          <InlineAlert tone="error" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}
        <p className="text-sm text-neutral-800">
          These values can only be made stricter here. Relaxing past the server baseline needs a server configuration
          change and client approval.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELDS.map(({ key, label, unit }, index) => {
            const limit = policy.limits[key]
            const invalid = outOfRange.some((f) => f.key === key)
            return (
              <div key={key}>
                <label htmlFor={`policy-${key}`} className="text-sm font-semibold text-neutral-900">
                  {label}
                </label>
                <input
                  id={`policy-${key}`}
                  type="number"
                  value={values[key]}
                  min={limit.minimum}
                  max={limit.maximum}
                  data-autofocus={index === 0 ? true : undefined}
                  aria-invalid={invalid}
                  aria-describedby={`policy-${key}-range`}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className={INPUT}
                />
                <p id={`policy-${key}-range`} className="mt-1 text-sm text-neutral-700">
                  {limit.minimum} to {limit.maximum} {unit}. Baseline {limit.baseline}.
                </p>
              </div>
            )
          })}
        </div>
        <div>
          <label htmlFor="policy-reason" className="text-sm font-semibold text-neutral-900">
            Reason for this change
          </label>
          <textarea
            id="policy-reason"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            rows={2}
            aria-describedby="policy-reason-hint"
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
          />
          <p id="policy-reason-hint" className="mt-1 text-sm text-neutral-700">
            At least {REASON_MIN_LENGTH} characters. Stored in the audit log.
          </p>
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="min-h-11 rounded border border-neutral-300 px-4 py-2 font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="min-h-11 rounded bg-[#8E1C3D] px-4 py-2 font-medium text-white hover:bg-[#5D0B26] disabled:opacity-50"
          >
            {update.isPending ? 'Saving...' : 'Save policy'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
