import { useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import {
  useBackups,
  useCreateBackup,
  useMe,
  useRestoreBackup,
  useVerifyBackup,
} from '../../api/queries'
import {
  BACKUP_LABEL_PATTERN,
  RESTORE_CONFIRMATION_PHRASE,
  RESTORE_REASON_MAX_LENGTH,
  RESTORE_REASON_MIN_LENGTH,
  type BackupArchiveInfo,
  type BackupVerifyResponse,
  type RestoreResultOut,
} from '../../api/types'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'
import { Modal } from '../../components/Modal'
import { BackupSchedulePanel } from './BackupSchedulePanel'

const IST_ZONE = 'Asia/Kolkata'

const INPUT =
  'block min-h-11 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]'
const LABEL = 'mb-1 block text-sm font-semibold text-slate-800'

interface ErrorView {
  message: string
  details: string[]
}

/**
 * Maps an operations API failure to a readable message. 422 validation_error responses carry
 * `fields: [{loc, message}]`; the operation codes carry a server message that is shown as-is.
 */
function describeError(err: unknown, fallbackPrefix: string): ErrorView {
  if (err instanceof ApiError) {
    const fields = Array.isArray(err.extra.fields) ? err.extra.fields : []
    const details = fields
      .map((f: unknown) => {
        if (typeof f !== 'object' || f === null) return null
        const entry = f as { loc?: unknown; message?: unknown }
        const loc = Array.isArray(entry.loc) ? entry.loc.filter((p) => p !== 'body').join('.') : ''
        const message = typeof entry.message === 'string' ? entry.message : 'Invalid value'
        return loc ? `${loc}: ${message}` : message
      })
      .filter((d): d is string => d !== null)
    switch (err.code) {
      case 'validation_error':
        return { message: `${fallbackPrefix}: the server rejected the request.`, details }
      case 'invalid_archive_filename':
        return { message: `${fallbackPrefix}: the archive name was rejected. ${err.message}`, details }
      case 'invalid_destination_dir':
        return { message: `${fallbackPrefix}: the destination folder was rejected. ${err.message}`, details }
      case 'invalid_backup_label':
        return { message: `${fallbackPrefix}: the backup label was rejected. ${err.message}`, details }
      case 'backup_corrupted':
        return {
          message: `${fallbackPrefix}: the archive failed verification, so nothing was restored. ${err.message}`,
          details,
        }
      case 'backup_failed':
      case 'restore_failed':
        return { message: err.message, details }
      default:
        return { message: `${fallbackPrefix}: ${err.message}`, details }
    }
  }
  return {
    message: `${fallbackPrefix}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    details: [],
  }
}

function ErrorAlert({ error, onDismiss }: { error: ErrorView; onDismiss: () => void }) {
  return (
    <InlineAlert tone="error" onDismiss={onDismiss}>
      <p>{error.message}</p>
      {error.details.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </InlineAlert>
  )
}

function formatIst(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-IN', { timeZone: IST_ZONE, dateStyle: 'medium', timeStyle: 'short' })} IST`
}

type VerifyResult = { kind: 'result'; result: BackupVerifyResponse } | { kind: 'error'; error: ErrorView }

export function BackupManagerPage() {
  const { data: me } = useMe()
  const [label, setLabel] = useState('')
  const [destinationDir, setDestinationDir] = useState('')
  const [backupError, setBackupError] = useState<ErrorView | null>(null)
  const [backupCreated, setBackupCreated] = useState<string | null>(null)

  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoreReason, setRestoreReason] = useState('')
  const [restoreError, setRestoreError] = useState<ErrorView | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreResultOut | null>(null)

  const [verifying, setVerifying] = useState<string | null>(null)
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({})

  const { data, isPending, isError, error, refetch, isFetching } = useBackups()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()
  const verifyBackup = useVerifyBackup()

  const trimmedLabel = label.trim()
  const labelInvalid = !BACKUP_LABEL_PATTERN.test(trimmedLabel)

  const trimmedReason = restoreReason.trim()
  const phraseOk = restorePhrase === RESTORE_CONFIRMATION_PHRASE
  const reasonOk =
    trimmedReason.length >= RESTORE_REASON_MIN_LENGTH && trimmedReason.length <= RESTORE_REASON_MAX_LENGTH
  const canRestore = phraseOk && reasonOk && !restoreBackup.isPending

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setBackupError(null)
    setBackupCreated(null)
    if (labelInvalid) {
      setBackupError({
        message: 'Backup not started: the label may contain only letters, digits, "_" and "-" (at most 50).',
        details: [],
      })
      return
    }
    try {
      const created = await createBackup.mutateAsync({
        label: trimmedLabel || undefined,
        destination_dir: destinationDir.trim() || undefined,
      })
      setBackupCreated(created.filename)
      setLabel('')
      setDestinationDir('')
    } catch (err: unknown) {
      setBackupError(describeError(err, 'Backup failed'))
    }
  }

  const openRestore = (filename: string) => {
    setRestorePhrase('')
    setRestoreReason('')
    setRestoreError(null)
    setRestoreTarget(filename)
  }

  const closeRestore = () => {
    setRestoreTarget(null)
    setRestorePhrase('')
    setRestoreReason('')
    setRestoreError(null)
  }

  const handleRestore = async () => {
    if (!restoreTarget || !canRestore) return
    setRestoreError(null)
    try {
      const res = await restoreBackup.mutateAsync({
        archive_filename: restoreTarget,
        confirmation_phrase: restorePhrase,
        reason: trimmedReason,
      })
      setRestoreResult(res)
      closeRestore()
    } catch (err: unknown) {
      setRestoreError(describeError(err, 'Restoration failed'))
    }
  }

  const handleVerify = async (filename: string) => {
    setVerifying(filename)
    try {
      const result = await verifyBackup.mutateAsync(filename)
      setVerifyResults((prev) => ({ ...prev, [filename]: { kind: 'result', result } }))
    } catch (err: unknown) {
      setVerifyResults((prev) => ({
        ...prev,
        [filename]: { kind: 'error', error: describeError(err, 'Verification failed') },
      }))
    } finally {
      setVerifying(null)
    }
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Backup & Recovery Manager</h1>
            <p className="mt-1 text-sm text-slate-700">
              Checksummed PostgreSQL dumps + patient photo bundles with fail-closed integrity checks (BAK-01, BAK-02)
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-60"
          >
            {isFetching ? 'Refreshing...' : 'Refresh Bundles'}
          </button>
        </div>

        {restoreResult && (
          <InlineAlert tone="success" onDismiss={() => setRestoreResult(null)}>
            <p className="font-semibold">Restore completed from {restoreResult.archive_restored}.</p>
            <p>Safety backup taken before the restore: {restoreResult.prerestore_snapshot ?? 'not reported'}</p>
            <p>
              Database restored: {restoreResult.database_restored ? 'yes' : 'no'} · Photos restored:{' '}
              {restoreResult.photos_restored_count}
            </p>
          </InlineAlert>
        )}

        {backupCreated && (
          <InlineAlert tone="success" onDismiss={() => setBackupCreated(null)}>
            Backup created: {backupCreated}
          </InlineAlert>
        )}

        {backupError && <ErrorAlert error={backupError} onDismiss={() => setBackupError(null)} />}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby="create-backup-heading">
          <h2 id="create-backup-heading" className="mb-3 text-base font-semibold text-slate-900">
            Create System Backup Bundle
          </h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="backup-label" className={LABEL}>
                Backup Label (Optional)
              </label>
              <input
                id="backup-label"
                type="text"
                placeholder="e.g. pre_migration, weekly_full"
                value={label}
                maxLength={50}
                aria-invalid={labelInvalid}
                aria-describedby="backup-label-hint"
                onChange={(e) => setLabel(e.target.value)}
                className={INPUT}
              />
              <p id="backup-label-hint" className={`mt-1 text-sm ${labelInvalid ? 'font-semibold text-red-800' : 'text-slate-700'}`}>
                Letters, digits, "_" and "-" only, at most 50.
              </p>
            </div>
            <div>
              <label htmlFor="backup-destination" className={LABEL}>
                Custom Destination (Optional Secondary Drive)
              </label>
              <input
                id="backup-destination"
                type="text"
                placeholder="e.g. E:\KalyanBackups"
                value={destinationDir}
                maxLength={1024}
                aria-describedby="backup-destination-hint"
                onChange={(e) => setDestinationDir(e.target.value)}
                className={INPUT}
              />
              <p id="backup-destination-hint" className="mt-1 text-sm text-slate-700">
                An existing folder on the server PC.
              </p>
            </div>
            <div className="sm:pt-6">
              <button
                type="submit"
                disabled={createBackup.isPending}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26] disabled:opacity-60"
              >
                {createBackup.isPending ? 'Generating Bundle...' : 'Trigger Backup Now'}
              </button>
            </div>
          </form>
        </section>

        <BackupSchedulePanel />

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs" aria-labelledby="archives-heading">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
            <div>
              <h2 id="archives-heading" className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Available Backup Archives
              </h2>
              <p className="mt-0.5 break-all font-mono text-sm text-slate-700">
                Storage: {data?.backup_dir ?? 'Loading...'}
              </p>
            </div>
            {data && (
              <span className="rounded bg-slate-200 px-2 py-0.5 text-sm font-bold text-slate-800">
                {data.total_count} Total Archives
              </span>
            )}
          </div>

          {isPending && (
            <p role="status" className="p-8 text-center text-sm text-slate-700">
              Discovering backup archives...
            </p>
          )}
          {isError && (
            <div className="p-4">
              <InlineAlert tone="error">Failed to load backup archives: {error.message}</InlineAlert>
            </div>
          )}

          {data && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-800">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-700">Archive File</th>
                    <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-700">Creation Date</th>
                    <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-700">Size</th>
                    <th scope="col" className="px-4 py-3 text-sm font-semibold text-slate-700">SHA-256 Verification</th>
                    <th scope="col" className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.backups.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-700">
                        No backup archives found on server.
                      </td>
                    </tr>
                  ) : (
                    data.backups.map((b: BackupArchiveInfo) => {
                      const verify = verifyResults[b.filename]
                      return (
                        <tr key={b.filename} className="align-top hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-semibold text-neutral-900">{b.filename}</p>
                            {b.label && (
                              <span className="inline-block mt-0.5 px-2 py-0.2 text-[10px] bg-neutral-100 text-neutral-600 rounded">
                                {b.label}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">{formatIst(b.created_at)}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-800">
                            {(b.size_bytes / (1024 * 1024)).toFixed(2)} MB
                          </td>
                          <td className="px-4 py-3">
                            {b.is_valid ? (
                              <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-sm font-medium text-emerald-800">
                                ✓ Cryptographically Verified
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-sm font-medium text-red-800">
                                ⚠ Checksum Mismatch
                              </span>
                            )}
                            {verify && (
                              <div role="status" className="mt-2 max-w-md text-sm">
                                {verify.kind === 'result' ? (
                                  <p className={verify.result.valid ? 'text-emerald-800' : 'font-semibold text-red-800'}>
                                    <span className="font-semibold">
                                      {verify.result.valid ? 'Verify: archive is valid.' : 'Verify: archive is NOT valid.'}
                                    </span>{' '}
                                    {verify.result.details}
                                  </p>
                                ) : (
                                  <div className="text-red-800">
                                    <p className="font-semibold">{verify.error.message}</p>
                                    {verify.error.details.map((d) => (
                                      <p key={d}>{d}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button
                                type="button"
                                onClick={() => void handleVerify(b.filename)}
                                disabled={verifying !== null}
                                aria-label={`Verify ${b.filename}`}
                                className="inline-flex min-h-11 items-center rounded border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-50"
                              >
                                {verifying === b.filename ? 'Verifying...' : 'Verify'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openRestore(b.filename)}
                                disabled={!b.is_valid}
                                className="inline-flex min-h-11 items-center rounded border border-red-300 bg-red-50 px-3 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                              >
                                Restore System
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {restoreTarget && (
          <Modal
            open
            variant="destructive"
            title="⚠ Confirm System Restoration"
            onClose={closeRestore}
            busy={restoreBackup.isPending}
            className="max-w-lg"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-800">
                You are about to replace the Kalyan Hospital database and patient photographs with the contents of
                this archive:
              </p>
              <p className="break-all rounded bg-slate-100 p-3 font-mono text-sm text-slate-900">{restoreTarget}</p>
              <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">A safety backup is always taken first.</p>
                <p>
                  Before anything is changed, the server saves a complete backup of the current database and photos.
                  This step cannot be skipped. If the archive fails verification, the restore stops and nothing is
                  changed.
                </p>
              </div>
              <div>
                <label htmlFor="restore-phrase" className={LABEL}>
                  Type {RESTORE_CONFIRMATION_PHRASE} to confirm
                </label>
                <input
                  id="restore-phrase"
                  type="text"
                  value={restorePhrase}
                  onChange={(e) => setRestorePhrase(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={restorePhrase !== '' && !phraseOk}
                  className={`${INPUT} font-mono`}
                />
              </div>
              <div>
                <label htmlFor="restore-reason" className={LABEL}>
                  Reason for restore
                </label>
                <textarea
                  id="restore-reason"
                  value={restoreReason}
                  onChange={(e) => setRestoreReason(e.target.value)}
                  maxLength={RESTORE_REASON_MAX_LENGTH}
                  rows={3}
                  aria-describedby="restore-reason-hint"
                  aria-invalid={restoreReason !== '' && !reasonOk}
                  className="block w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]"
                />
                <p id="restore-reason-hint" className="mt-1 text-sm text-slate-700">
                  {trimmedReason.length} of {RESTORE_REASON_MIN_LENGTH}-{RESTORE_REASON_MAX_LENGTH} characters. The
                  reason is stored in the audit log.
                </p>
              </div>
              {restoreError && <ErrorAlert error={restoreError} onDismiss={() => setRestoreError(null)} />}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  data-autofocus
                  disabled={restoreBackup.isPending}
                  onClick={closeRestore}
                  className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canRestore}
                  onClick={() => void handleRestore()}
                  className="inline-flex min-h-11 items-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26] disabled:opacity-50"
                >
                  {restoreBackup.isPending ? 'Restoring System...' : 'Yes, Execute Safe Restore'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  )
}
