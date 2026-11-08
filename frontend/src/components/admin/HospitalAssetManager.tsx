import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { useDeactivateAsset, useHospitalAssets, useUploadAsset } from '../../api/queries'
import type { AssetType, HospitalAssetOut } from '../../api/types'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatAssetType(type: AssetType): string {
  switch (type) {
    case 'LOGO':
      return 'Hospital Logo & Crest'
    case 'REGISTRATION_DOC':
      return 'Registration / Trust Certificate'
    case 'PHOTO':
      return 'Clinic Facility Photograph'
    default:
      return type
  }
}

export interface HospitalAssetManagerParts {
  /** Active crest and logo card with the upload action. */
  logo: ReactNode
  /** Full-width table of every asset version. */
  library: ReactNode
}

interface HospitalAssetManagerProps {
  /** Places the two panels inside a host page; the modals stay owned by this component. Stacks them when omitted. */
  layout?: (parts: HospitalAssetManagerParts) => ReactNode
}

export function HospitalAssetManager({ layout }: HospitalAssetManagerProps = {}) {
  const { data: assets = [], isLoading, error: fetchError } = useHospitalAssets()
  const uploadMutation = useUploadAsset()
  const deactivateMutation = useDeactivateAsset()

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedType, setSelectedType] = useState<AssetType>('LOGO')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Deactivate modal state
  const [deactivatingAsset, setDeactivatingAsset] = useState<HospitalAssetOut | null>(null)

  // Inspect / preview modal state
  const [inspectAsset, setInspectAsset] = useState<HospitalAssetOut | null>(null)

  // Locate active logo from list
  const activeLogo = useMemo(() => {
    return assets.find((a) => a.asset_type === 'LOGO' && a.is_active) ?? null
  }, [assets])

  const handleFileSelect = (file: File | null) => {
    setUploadError(null)
    if (!file) {
      setSelectedFile(null)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Uploaded asset exceeds maximum allowed size of 10 MB.')
      setSelectedFile(null)
      return
    }
    setSelectedFile(file)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0])
    }
  }

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      setUploadError('Please choose a file to upload.')
      return
    }
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('asset_type', selectedType)

    try {
      await uploadMutation.mutateAsync(formData)
      setIsUploadOpen(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Asset upload failed.'
      setUploadError(msg)
    }
  }

  const openUploadModal = () => {
    setUploadError(null)
    setSelectedFile(null)
    setIsUploadOpen(true)
  }

  const handleConfirmDeactivation = async () => {
    if (!deactivatingAsset) return
    try {
      await deactivateMutation.mutateAsync(deactivatingAsset.id)
      setDeactivatingAsset(null)
    } catch (err: unknown) {
      // Keep modal open to show failure if needed
      console.error('Failed to deactivate asset', err)
    }
  }

  const logoPanel = (
    <section
      id="hospital-crest"
      className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
      aria-labelledby="active-logo-heading"
    >
      {fetchError && (
        <div className="mb-4">
          <InlineAlert tone="error">
            Failed to load hospital assets: {fetchError instanceof Error ? fetchError.message : 'Server error'}
          </InlineAlert>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h2 id="active-logo-heading" className="text-lg font-semibold text-brand-900">
          Active Hospital Crest & Logo
        </h2>
        <span
          className="inline-flex shrink-0 items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
          data-testid="active-logo-badge"
        >
          ACTIVE
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Shown on the login screen, print letterheads, receipts and patient cards.
      </p>

      <div className="mt-4 flex aspect-[4/3] max-h-56 w-full items-center justify-center rounded-lg border-2 border-gold-500 bg-slate-50 p-4">
        <img
          src="/api/assets/active-logo"
          alt="Active hospital crest"
          className="max-h-full max-w-full object-contain"
          onError={(e) => {
            // Fallback in case of network interruption
            ;(e.target as HTMLImageElement).src = '/kalyan-hospital-crest.webp'
          }}
        />
      </div>

      {activeLogo ? (
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-medium text-slate-600">File</dt>
          <dd className="truncate text-slate-900" title={activeLogo.original_filename}>
            {activeLogo.original_filename}
          </dd>
          <dt className="font-medium text-slate-600">Type</dt>
          <dd className="text-slate-900">{activeLogo.mime_type}</dd>
          <dt className="font-medium text-slate-600">Size</dt>
          <dd className="text-slate-900">{formatFileSize(activeLogo.file_size_bytes)}</dd>
          <dt className="font-medium text-slate-600">Version</dt>
          <dd className="text-slate-900">v{activeLogo.version}</dd>
          <dt className="font-medium text-slate-600">Uploaded</dt>
          <dd className="text-slate-900">{DATE_FORMATTER.format(new Date(activeLogo.created_at))}</dd>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-amber-800">
          The default Kalyan Hospital crest is in use. Upload a custom logo to update letterheads.
        </p>
      )}

      <button
        type="button"
        onClick={openUploadModal}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer"
        data-testid="upload-asset-trigger"
      >
        Upload Hospital Asset
      </button>
    </section>
  )

  const libraryPanel = (
    <section id="asset-library" className="scroll-mt-4 space-y-4" aria-labelledby="history-heading">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="history-heading" className="text-lg font-bold text-slate-900">
            Historical Asset Library & Versions
          </h2>
          <p className="text-sm text-slate-600">
            Past asset versions are permanently retained so historical receipts and prescriptions maintain integrity.
          </p>
        </div>
        <span className="text-xs text-slate-500">{assets.length} registered asset(s)</span>
      </div>

      {assets.length === 0 && !isLoading ? (
        /* Empty State per UI-SPEC Copywriting Contract */
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center"
          data-testid="asset-empty-state"
        >
          <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-600">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900">No Additional Assets Uploaded</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Only the default hospital crest is currently registered. Click &apos;Upload Hospital Asset&apos; to add clinic photos or registration documents.
          </p>
          <button
            type="button"
            onClick={openUploadModal}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-brand-800 cursor-pointer"
          >
            Upload Hospital Asset
          </button>
        </div>
      ) : (
        /* Table of Asset Versions */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3.5">
                    Preview Thumbnail
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Asset Type
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Filename
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    File Size
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Uploaded By
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Date Uploaded
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {assets.map((asset) => (
                  <tr key={asset.id} className="transition hover:bg-slate-50/75" data-testid={`asset-row-${asset.id}`}>
                    {/* Thumbnail */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setInspectAsset(asset)}
                        className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 hover:border-slate-300 cursor-pointer"
                        title="Click to inspect asset"
                      >
                        {asset.mime_type.startsWith('image/') ? (
                          <img
                            src={`/api/admin/assets/${asset.id}/file`}
                            alt={asset.original_filename}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xs font-bold uppercase text-slate-500">PDF</span>
                        )}
                      </button>
                    </td>

                    {/* Asset Type */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-medium text-slate-900">{formatAssetType(asset.asset_type)}</span>
                      {asset.asset_type === 'LOGO' && (
                        <span className="ml-1.5 text-xs text-slate-500">(v{asset.version})</span>
                      )}
                    </td>

                    {/* Filename */}
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-slate-800" title={asset.original_filename}>
                      {asset.original_filename}
                    </td>

                    {/* File Size */}
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatFileSize(asset.file_size_bytes)}
                    </td>

                    {/* Uploaded By */}
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {asset.uploaded_by_name || `User #${asset.uploaded_by_user_id}`}
                    </td>

                    {/* Date Uploaded */}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {DATE_FORMATTER.format(new Date(asset.created_at))}
                    </td>

                    {/* Status */}
                    <td className="whitespace-nowrap px-4 py-3">
                      {asset.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200">
                          ARCHIVED
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setInspectAsset(asset)}
                          className="inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          Preview
                        </button>
                        {asset.is_active && (
                          <button
                            type="button"
                            onClick={() => setDeactivatingAsset(asset)}
                            className="inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 hover:text-red-800 cursor-pointer"
                            data-testid={`deactivate-trigger-${asset.id}`}
                          >
                            Deactivate Hospital Asset
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )

  return (
    <div data-testid="hospital-asset-manager" className={layout ? undefined : 'space-y-8'}>
      {layout ? (
        layout({ logo: logoPanel, library: libraryPanel })
      ) : (
        <>
          {logoPanel}
          {libraryPanel}
        </>
      )}

      {/* 3. Upload Modal */}
      <Modal
        open={isUploadOpen}
        onClose={() => {
          if (!uploadMutation.isPending) {
            setIsUploadOpen(false)
            setSelectedFile(null)
          }
        }}
        title="Upload Hospital Asset"
        description="Upload official hospital crest, trust registration certificates, or clinic photographs."
        busy={uploadMutation.isPending}
      >
        <div className="space-y-5">
          {uploadError && <InlineAlert tone="error">{uploadError}</InlineAlert>}

          {/* Asset Type Selector */}
          <div>
            <label htmlFor="asset-type-select" className="block text-xs font-semibold uppercase text-slate-700">
              Asset Type <span className="text-red-700">*</span>
            </label>
            <select
              id="asset-type-select"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as AssetType)}
              className="mt-1.5 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-brand-700 focus:outline-none"
            >
              <option value="LOGO">Hospital Logo & Crest</option>
              <option value="REGISTRATION_DOC">Registration / Trust Certificate</option>
              <option value="PHOTO">Clinic Facility Photograph</option>
            </select>
            {selectedType === 'LOGO' && (
              <p className="mt-1.5 text-xs text-amber-700">
                Notice: Uploading a new logo will automatically increment the version and mark any older logo as archived.
              </p>
            )}
          </div>

          {/* Drag & Drop Dropzone */}
          <div>
            <label htmlFor="asset-file-input" className="block text-xs font-semibold uppercase text-slate-700">
              Asset File <span className="text-red-700">*</span>
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-1.5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                isDragging
                  ? 'border-brand-700 bg-brand-50'
                  : 'border-slate-300 bg-slate-50/50 hover:bg-slate-100/50'
              }`}
            >
              <input
                id="asset-file-input"
                ref={fileInputRef}
                type="file"
                aria-label="Upload hospital asset file"
                accept=".png,.jpg,.jpeg,.webp,.svg,.pdf"
                onChange={handleFileInputChange}
                className="hidden"
                data-testid="asset-file-input"
              />

              <svg className="mb-2 h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>

              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-800">
                    <span className="font-semibold text-brand-700">Click to browse</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-500">PNG, JPEG, WebP, SVG, and PDF documents up to 10 MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              disabled={uploadMutation.isPending}
              onClick={() => {
                setIsUploadOpen(false)
                setSelectedFile(null)
              }}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedFile || uploadMutation.isPending}
              onClick={handleUploadSubmit}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-brand-800 disabled:opacity-50 cursor-pointer"
              data-testid="submit-asset-upload"
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload Hospital Asset'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 4. Deactivation Confirmation Modal */}
      <Modal
        open={Boolean(deactivatingAsset)}
        onClose={() => {
          if (!deactivateMutation.isPending) {
            setDeactivatingAsset(null)
          }
        }}
        variant="destructive"
        title="Deactivate Hospital Asset"
        busy={deactivateMutation.isPending}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Are you sure you want to deactivate {deactivatingAsset?.original_filename}? The asset will remain stored in historical archive for past print references, but will no longer appear on active letterheads or the login screen. Click &apos;Confirm Asset Deactivation&apos; to proceed or &apos;Keep Asset Active&apos; to return.
          </p>

          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              disabled={deactivateMutation.isPending}
              onClick={() => setDeactivatingAsset(null)}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
              data-testid="cancel-deactivation-button"
            >
              Keep Asset Active
            </button>
            <button
              type="button"
              disabled={deactivateMutation.isPending}
              onClick={handleConfirmDeactivation}
              className="inline-flex min-h-11 items-center rounded-lg bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-800 disabled:opacity-50 cursor-pointer"
              data-testid="confirm-deactivation-button"
            >
              {deactivateMutation.isPending ? 'Deactivating...' : 'Confirm Asset Deactivation'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 5. Inspect / Preview Modal */}
      <Modal
        open={Boolean(inspectAsset)}
        onClose={() => setInspectAsset(null)}
        title={inspectAsset ? inspectAsset.original_filename : 'Asset Preview'}
        className="max-w-2xl"
      >
        {inspectAsset && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{formatAssetType(inspectAsset.asset_type)}</span>
              <span>{formatFileSize(inspectAsset.file_size_bytes)}</span>
            </div>

            <div className="flex min-h-64 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-4">
              {inspectAsset.mime_type.startsWith('image/') ? (
                <img
                  src={`/api/admin/assets/${inspectAsset.id}/file`}
                  alt={inspectAsset.original_filename}
                  className="max-h-96 max-w-full rounded object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm font-medium text-slate-800">PDF Document ({inspectAsset.original_filename})</p>
                  <a
                    href={`/api/admin/assets/${inspectAsset.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
                  >
                    Open PDF in New Tab
                  </a>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setInspectAsset(null)}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
