import { useState } from 'react'
import { AdminPageLayout } from '../../components/AdminPageLayout'
import { useBackups, useCreateBackup, useRestoreBackup } from '../../api/queries'
import type { BackupArchiveInfo } from '../../api/types'

export function BackupManagerPage() {
  const [label, setLabel] = useState('')
  const [destinationDir, setDestinationDir] = useState('')
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<string | null>(null)
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useBackups()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createBackup.mutateAsync({
        label: label.trim() || undefined,
        destination_dir: destinationDir.trim() || undefined,
      })
      setLabel('')
      setDestinationDir('')
    } catch (err: unknown) {
      alert(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleRestore = async (archiveFilename: string) => {
    try {
      setRestoreStatus('Verifying archive and restoring database...')
      const res = await restoreBackup.mutateAsync({
        archive_filename: archiveFilename,
        create_prerestore_snapshot: true,
      })
      setRestoreStatus(
        `Restoration completed successfully! Pre-restore safety snapshot created: ${
          res.prerestore_snapshot || 'None'
        }`
      )
      setConfirmRestoreFile(null)
      refetch()
    } catch (err: unknown) {
      setRestoreStatus(`Restoration failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return (
    <AdminPageLayout title="Backup & Recovery" description="Create and inspect backup archives. Restore operations replace active system data and require deliberate confirmation." actions={<button type="button" onClick={() => refetch()} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]">Refresh Archives</button>}>
      <div className="space-y-6">
        {/* Status notification */}
        {restoreStatus && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900 flex justify-between items-center">
            <span>{restoreStatus}</span>
            <button
              type="button"
              onClick={() => setRestoreStatus(null)}
              className="text-amber-700 hover:text-amber-900 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Create Backup Box */}
        <div className="bg-white p-5 rounded-lg border border-neutral-200 shadow-xs">
          <h2 className="text-base font-semibold text-neutral-900 mb-3">Create System Backup Bundle</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="backup-label" className="block text-xs font-semibold text-neutral-700 mb-1">
                Backup Label (Optional)
              </label>
              <input
                id="backup-label"
                type="text"
                placeholder="e.g. pre_migration, weekly_full"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              />
            </div>
            <div>
              <label htmlFor="backup-destination" className="block text-xs font-semibold text-neutral-700 mb-1">
                Custom Destination (Optional Secondary Drive)
              </label>
              <input
                id="backup-destination"
                type="text"
                placeholder="e.g. E:\KalyanBackups"
                value={destinationDir}
                onChange={(e) => setDestinationDir(e.target.value)}
                className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={createBackup.isPending}
                className="w-full py-2 px-4 bg-red-800 hover:bg-red-900 text-white font-medium text-sm rounded disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {createBackup.isPending ? 'Generating Bundle...' : 'Trigger Backup Now'}
              </button>
            </div>
          </form>
        </div>

        {/* Backup Bundles List */}
        <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-neutral-50 border-b border-neutral-200 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">
                Available Backup Archives
              </h2>
              <p className="text-xs text-neutral-500 font-mono mt-0.5">
                Storage: {data?.backup_dir || 'Loading...'}
              </p>
            </div>
            <span className="text-xs bg-neutral-200 text-neutral-700 font-bold px-2 py-0.5 rounded">
              {data?.total_count || 0} Total Archives
            </span>
          </div>

          {isPending && <div className="p-8 text-center text-neutral-500">Discovering backup archives...</div>}
          {isError && (
            <div className="p-8 text-center text-red-600">
              Failed to load backup archives: {error?.message}
            </div>
          )}

          {data && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-700">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Archive File</th>
                    <th className="px-4 py-3">Creation Date</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">SHA-256 Verification</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {data.backups.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                        No backup archives found on server.
                      </td>
                    </tr>
                  ) : (
                    data.backups.map((b: BackupArchiveInfo) => (
                      <tr key={b.filename} className="hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-semibold text-neutral-900">{b.filename}</p>
                          {b.label && (
                            <span className="inline-block mt-0.5 px-2 py-0.2 text-[10px] bg-neutral-100 text-neutral-600 rounded">
                              {b.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600 font-mono">
                          {(b.size_bytes / (1024 * 1024)).toFixed(2)} MB
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {b.is_valid ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                              ✓ Cryptographically Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-medium">
                              ⚠ Checksum Mismatch
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreFile(b.filename)}
                            disabled={!b.is_valid}
                            className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-semibold rounded border border-red-200 disabled:opacity-40 cursor-pointer"
                          >
                            Restore System
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Confirmation Modal */}
        {confirmRestoreFile && (
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-neutral-300 space-y-4">
              <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
                ⚠ Confirm System Restoration
              </h3>
              <p className="text-sm text-neutral-700">
                You are about to restore the Kalyan Hospital database and patient photographs from archive:
              </p>
              <div className="p-3 bg-neutral-100 rounded font-mono text-xs text-neutral-800 break-all">
                {confirmRestoreFile}
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 space-y-1">
                <p className="font-semibold">Automatic Pre-Restore Safety Snapshot Guarantee:</p>
                <p>
                  A complete pre-restore snapshot of the active system state will be automatically captured
                  before any tables are reset. If archive verification fails, restoration is aborted
                  instantly without touching the database.
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmRestoreFile(null)}
                  className="px-4 py-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 text-sm font-medium rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={restoreBackup.isPending}
                  onClick={() => handleRestore(confirmRestoreFile)}
                  className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white text-sm font-semibold rounded cursor-pointer disabled:opacity-50"
                >
                  {restoreBackup.isPending ? 'Restoring System...' : 'Yes, Execute Safe Restore'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminPageLayout>
  )
}
