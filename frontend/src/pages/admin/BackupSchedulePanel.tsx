import { useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useBackupRuns, useBackupSettings, useUpdateBackupSettings } from '../../api/queries'
import type { BackupRunOut, BackupSettingsOut } from '../../api/types'
import { ConflictBanner } from '../../components/ConflictBanner'
import { InlineAlert } from '../../components/InlineAlert'

// Admin module 11. The Windows scheduled task reads these settings every 15 minutes. Backups stay
// off until the schedule is enabled, and retention only ever removes scheduled archives.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const REASON_MIN_LENGTH = 10

const INPUT =
  'mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 min-h-11 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'
const LABEL = 'text-sm font-semibold text-slate-800'
const CELL = 'px-3 py-2 text-sm text-slate-800'
const HEAD = 'px-3 py-2 text-left text-sm font-semibold text-slate-700'

function formatIst(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

interface FormState {
  enabled: boolean
  frequency: BackupSettingsOut['frequency']
  runAt: string
  weeklyDay: string
  destination: string
  retention: string
}

function toForm(s: BackupSettingsOut): FormState {
  return {
    enabled: s.schedule_enabled,
    frequency: s.frequency,
    runAt: s.run_at.slice(0, 5),
    weeklyDay: String(s.weekly_day ?? 0),
    destination: s.destination_dir ?? '',
    retention: s.retention_count === null ? '' : String(s.retention_count),
  }
}

function ScheduleForm({ settings, onReload, isReloading }: { settings: BackupSettingsOut; onReload: () => void; isReloading: boolean }) {
  const update = useUpdateBackupSettings()
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState(false)

  const retentionValue = form.retention === '' ? null : Number(form.retention)
  const retentionOk = retentionValue === null || (Number.isInteger(retentionValue) && retentionValue >= 1)
  const canSave = reason.trim().length >= REASON_MIN_LENGTH && retentionOk && !update.isPending
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    try {
      const updated = await update.mutateAsync({
        version_id: settings.version_id,
        schedule_enabled: form.enabled,
        frequency: form.frequency,
        run_at: form.runAt,
        weekly_day: form.frequency === 'WEEKLY' ? Number(form.weeklyDay) : null,
        destination_dir: form.destination || null,
        retention_count: retentionValue,
        reason: reason.trim(),
      })
      setForm(toForm(updated))
      setReason('')
      setSaved(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
      } else {
        setError(err instanceof Error ? err.message : 'Could not save the backup schedule.')
      }
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
      {conflict && <ConflictBanner onReload={onReload} isReloading={isReloading} />}
      {error && (
        <InlineAlert tone="error" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {saved && (
        <InlineAlert tone="success" onDismiss={() => setSaved(false)}>
          Backup schedule saved.
        </InlineAlert>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-900">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-5 w-5" />
        Run scheduled backups
      </label>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label htmlFor="backup-frequency" className={LABEL}>Frequency</label>
          <select
            id="backup-frequency"
            value={form.frequency}
            onChange={(e) => set('frequency', e.target.value as FormState['frequency'])}
            className={INPUT}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
        </div>
        {form.frequency === 'WEEKLY' && (
          <div>
            <label htmlFor="backup-weekday" className={LABEL}>Day</label>
            <select id="backup-weekday" value={form.weeklyDay} onChange={(e) => set('weeklyDay', e.target.value)} className={INPUT}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="backup-time" className={LABEL}>Time (IST)</label>
          <input id="backup-time" type="time" value={form.runAt} onChange={(e) => set('runAt', e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="backup-destination-setting" className={LABEL}>Second copy</label>
          <select
            id="backup-destination-setting"
            value={form.destination}
            aria-describedby="backup-destination-hint"
            onChange={(e) => set('destination', e.target.value)}
            className={INPUT}
          >
            <option value="">No second copy</option>
            {settings.approved_destinations.map((path) => (
              <option key={path} value={path}>{path}</option>
            ))}
          </select>
          <p id="backup-destination-hint" className="mt-1 text-sm text-slate-700">
            {settings.approved_destinations.length === 0
              ? 'No second drive is approved on this server yet.'
              : 'Each backup is copied here and checked after it is written.'}
          </p>
        </div>
        <div>
          <label htmlFor="backup-retention" className={LABEL}>Scheduled backups to keep</label>
          <input
            id="backup-retention"
            type="number"
            min={1}
            value={form.retention}
            aria-invalid={!retentionOk}
            aria-describedby="backup-retention-hint"
            onChange={(e) => set('retention', e.target.value)}
            className={INPUT}
          />
          <p id="backup-retention-hint" className="mt-1 text-sm text-slate-700">
            Blank keeps all. Older scheduled backups are deleted permanently; manual and safety backups are never removed.
          </p>
        </div>
      </div>
      <div>
        <label htmlFor="backup-schedule-reason" className={LABEL}>Reason for this change</label>
        <input
          id="backup-schedule-reason"
          type="text"
          value={reason}
          maxLength={500}
          aria-describedby="backup-schedule-reason-hint"
          onChange={(e) => setReason(e.target.value)}
          className={INPUT}
        />
        <p id="backup-schedule-reason-hint" className="mt-1 text-sm text-slate-700">
          At least {REASON_MIN_LENGTH} characters. Stored in the audit log.
        </p>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSave}
          className="min-h-11 rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26] disabled:opacity-50"
        >
          {update.isPending ? 'Saving...' : 'Save schedule'}
        </button>
      </div>
    </form>
  )
}

function RunHistory({ runs }: { runs: BackupRunOut[] }) {
  if (runs.length === 0) {
    return <p className="mt-2 text-sm text-slate-700">No backup runs recorded yet.</p>
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className={HEAD}>Started</th>
            <th scope="col" className={HEAD}>Type</th>
            <th scope="col" className={HEAD}>Result</th>
            <th scope="col" className={HEAD}>Archive</th>
            <th scope="col" className={HEAD}>Second copy</th>
            <th scope="col" className={HEAD}>Old backups removed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className={CELL}>{formatIst(run.started_at)}</td>
              <td className={CELL}>{run.trigger === 'SCHEDULED' ? 'Scheduled' : 'Manual'}</td>
              <td className={CELL}>
                {run.outcome === 'SUCCESS' ? 'Succeeded' : run.outcome === 'RUNNING' ? 'Running' : `Failed (${run.error_type ?? 'unknown'})`}
              </td>
              <td className={`${CELL} break-all font-mono`}>{run.filename ?? 'None'}</td>
              <td className={`${CELL} break-all`}>{run.copied_to ?? 'None'}</td>
              <td className={CELL}>{run.pruned_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BackupSchedulePanel() {
  const settings = useBackupSettings()
  const runs = useBackupRuns()
  const data = settings.data

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby="backup-schedule-heading">
      <h2 id="backup-schedule-heading" className="text-base font-bold text-slate-900">
        Scheduled backups
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        Needs the Windows task from deploy\register-backup-task.ps1 on the server. Frequency and retention await client
        approval.
      </p>
      {settings.isPending && <p role="status" className="mt-3 text-sm text-slate-700">Loading the backup schedule...</p>}
      {settings.isError && (
        <InlineAlert tone="error" className="mt-3">
          Could not load the backup schedule: {settings.error.message}
        </InlineAlert>
      )}
      {data && (
        <>
          {data.overdue && (
            <InlineAlert tone="error" className="mt-3">
              A scheduled backup did not run. Check the Windows scheduled task on the server.
            </InlineAlert>
          )}
          {data.next_run_at && <p className="mt-3 text-sm text-slate-800">Next run: {formatIst(data.next_run_at)} IST</p>}
          <ScheduleForm
            key={data.version_id}
            settings={data}
            onReload={() => void settings.refetch()}
            isReloading={settings.isFetching}
          />
        </>
      )}
      <h3 className="mt-6 text-sm font-bold text-slate-900">Recent backup runs</h3>
      {runs.isError && (
        <InlineAlert tone="error" className="mt-2">
          Could not load backup runs: {runs.error.message}
        </InlineAlert>
      )}
      {runs.data && <RunHistory runs={runs.data} />}
    </section>
  )
}
