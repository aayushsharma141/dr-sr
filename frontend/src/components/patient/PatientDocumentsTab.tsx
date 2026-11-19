import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import {
  downloadPatientDocumentBlob,
  useArchivePatientDocument,
  usePatientDocuments,
  useUploadPatientDocument,
} from '../../api/queries'
import type { DocumentCategory, PatientDocumentOut, Role } from '../../api/types'
import { formatIst } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'
import {
  IconEye,
  IconNotes,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '../icons'

export interface PatientDocumentsTabProps {
  patientId: number
  role: Role
  permissions: string[]
  isActive?: boolean
  isArchived?: boolean
  isMerged?: boolean
  currentUserId?: number | null
  currentDoctorId?: number | null
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024 // 10 MB

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png'])

const CLINICAL_CATEGORIES: readonly DocumentCategory[] = [
  'LAB_REPORT',
  'IMAGING',
  'PRESCRIPTION_SCAN',
  'DISCHARGE_SUMMARY',
]

const NON_CLINICAL_CATEGORIES: readonly DocumentCategory[] = [
  'REFERRAL',
  'ID_PROOF',
  'INSURANCE',
  'OTHER',
]

const CLINICAL_CATEGORY_SET = new Set<string>(CLINICAL_CATEGORIES)

const CATEGORY_META: Record<DocumentCategory, { label: string; className: string }> = {
  LAB_REPORT: {
    label: 'Lab Report',
    className: 'border border-sky-200 bg-sky-50 text-sky-900',
  },
  IMAGING: {
    label: 'Imaging',
    className: 'border border-indigo-200 bg-indigo-50 text-indigo-900',
  },
  PRESCRIPTION_SCAN: {
    label: 'Prescription Scan',
    className: 'border border-purple-200 bg-purple-50 text-purple-900',
  },
  DISCHARGE_SUMMARY: {
    label: 'Discharge Summary',
    className: 'border border-teal-200 bg-teal-50 text-teal-800',
  },
  REFERRAL: {
    label: 'Referral',
    className: 'border border-amber-200 bg-amber-50 text-amber-900',
  },
  ID_PROOF: {
    label: 'ID Proof',
    className: 'border border-slate-200 bg-slate-100 text-slate-800',
  },
  INSURANCE: {
    label: 'Insurance',
    className: 'border border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  OTHER: {
    label: 'Other',
    className: 'border border-slate-200 bg-slate-100 text-slate-800',
  },
}

const INPUT_CLASS =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-500 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-700'

interface ImagePreviewState {
  doc: PatientDocumentOut
  url: string
  filename: string
}

function getCategoryBadge(category: string): { label: string; className: string } {
  return (
    CATEGORY_META[category as DocumentCategory] ?? {
      label: category.replace(/_/g, ' '),
      className: 'border border-slate-200 bg-slate-100 text-slate-800',
    }
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function isImageMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';')[0].trim()
  return normalized === 'image/jpeg' || normalized === 'image/png'
}

function isPdfMime(mimeType: string): boolean {
  return mimeType.toLowerCase().split(';')[0].trim() === 'application/pdf'
}

function validateUploadFile(file: File | null): string | null {
  if (!file) return 'Please choose a PDF, JPEG, or PNG file to upload.'
  if (file.size === 0) return 'Selected file is empty.'
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'File exceeds the 10 MB maximum allowed size.'
  }

  const mime = file.type.toLowerCase().trim()
  const lowerName = file.name.toLowerCase()
  const dotIdx = lowerName.lastIndexOf('.')
  const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : ''

  if (mime) {
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return 'Unsupported file format. Only PDF, JPEG, and PNG files are allowed.'
    }
  } else if (!ALLOWED_EXTENSIONS.has(ext)) {
    return 'Unsupported file format. Only PDF, JPEG, and PNG files are allowed.'
  }

  return null
}

function defaultTitleFromFilename(filename: string): string {
  const stripped = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  return stripped.slice(0, 160)
}

function errorMessageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export function PatientDocumentsTab({
  patientId,
  role,
  permissions,
  isActive = true,
  isArchived = false,
  isMerged = false,
  currentUserId = null,
  currentDoctorId = null,
}: PatientDocumentsTabProps) {
  const isDoctor = role === 'DOCTOR'
  const hasWritePermission = permissions.includes('document:write') && role !== 'ADMIN'
  const canUpload = hasWritePermission && isActive !== false && !isArchived && !isMerged

  const [showArchived, setShowArchived] = useState(false)
  const {
    data: documents = [],
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = usePatientDocuments(patientId, showArchived)

  const uploadMutation = useUploadPatientDocument(patientId)
  const archiveMutation = useArchivePatientDocument(patientId)

  const [loadingDocId, setLoadingDocId] = useState<number | null>(null)

  // Image preview modal state + Object URL cleanup tracking
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
  const activePreviewUrlRef = useRef<string | null>(null)
  const tempBlobCleanupsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Upload modal state
  const defaultCategory: DocumentCategory = isDoctor ? 'LAB_REPORT' : 'REFERRAL'
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory)
  const [isClinical, setIsClinical] = useState<boolean>(isDoctor)
  const [notes, setNotes] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Archive confirmation modal state
  const [archiveTarget, setArchiveTarget] = useState<PatientDocumentOut | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  // Revoke any active or scheduled Object URLs when unmounting.
  useEffect(() => {
    const cleanups = tempBlobCleanupsRef.current
    return () => {
      if (activePreviewUrlRef.current) {
        URL.revokeObjectURL(activePreviewUrlRef.current)
        activePreviewUrlRef.current = null
      }
      for (const [url, timerId] of cleanups.entries()) {
        clearTimeout(timerId)
        URL.revokeObjectURL(url)
      }
      cleanups.clear()
    }
  }, [])

  function scheduleTempUrlRevoke(url: string, delayMs: number) {
    const timerId = setTimeout(() => {
      URL.revokeObjectURL(url)
      tempBlobCleanupsRef.current.delete(url)
    }, delayMs)
    tempBlobCleanupsRef.current.set(url, timerId)
  }

  function closeImagePreview() {
    if (activePreviewUrlRef.current) {
      URL.revokeObjectURL(activePreviewUrlRef.current)
      activePreviewUrlRef.current = null
    }
    setImagePreview(null)
  }

  function triggerBrowserDownload(url: string, filename: string) {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener noreferrer'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  async function handlePreviewOrOpen(doc: PatientDocumentOut) {
    setLoadingDocId(doc.id)
    try {
      const { url, filename, contentType } = await downloadPatientDocumentBlob(doc.id)
      const effectiveMime = contentType || doc.mime_type

      if (isImageMime(effectiveMime) || isImageMime(doc.mime_type)) {
        if (activePreviewUrlRef.current) {
          URL.revokeObjectURL(activePreviewUrlRef.current)
        }
        activePreviewUrlRef.current = url
        setImagePreview({ doc, url, filename: filename || doc.original_filename })
        return
      }

      if (isPdfMime(effectiveMime) || isPdfMime(doc.mime_type)) {
        // CSP / X-Frame-Options: DENY safe: open in a new tab or fall back to download, never an <iframe>.
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) {
          triggerBrowserDownload(url, filename || doc.original_filename)
          scheduleTempUrlRevoke(url, 1500)
        } else {
          scheduleTempUrlRevoke(url, 60_000)
        }
        return
      }

      triggerBrowserDownload(url, filename || doc.original_filename)
      scheduleTempUrlRevoke(url, 1500)
    } catch (err) {
      toast.error(errorMessageOf(err, 'Failed to open document.'))
    } finally {
      setLoadingDocId(null)
    }
  }

  async function handleDirectDownload(doc: PatientDocumentOut) {
    setLoadingDocId(doc.id)
    try {
      const { url, filename } = await downloadPatientDocumentBlob(doc.id)
      triggerBrowserDownload(url, filename || doc.original_filename)
      scheduleTempUrlRevoke(url, 1500)
    } catch (err) {
      toast.error(errorMessageOf(err, 'Failed to download document.'))
    } finally {
      setLoadingDocId(null)
    }
  }

  function canArchiveDocument(doc: PatientDocumentOut): boolean {
    if (!hasWritePermission || doc.is_archived) return false
    if (role === 'RECEPTION') return !doc.is_clinical
    if (role === 'DOCTOR') {
      if (!doc.is_clinical) return true
      const matchesDoctor = currentDoctorId != null && doc.doctor_id === currentDoctorId
      const matchesUploader = currentUserId != null && doc.uploaded_by_user_id === currentUserId
      return matchesDoctor || matchesUploader
    }
    return false
  }

  function openUploadModal() {
    const initialCategory: DocumentCategory = isDoctor ? 'LAB_REPORT' : 'REFERRAL'
    setSelectedFile(null)
    setTitle('')
    setCategory(initialCategory)
    setIsClinical(isDoctor && CLINICAL_CATEGORY_SET.has(initialCategory))
    setNotes('')
    setUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setUploadOpen(true)
  }

  function closeUploadModal() {
    if (uploadMutation.isPending) return
    setUploadOpen(false)
    setUploadError(null)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    if (!file) {
      setUploadError(null)
      return
    }
    const validationErr = validateUploadFile(file)
    setUploadError(validationErr)
    if (!validationErr && !title.trim()) {
      setTitle(defaultTitleFromFilename(file.name))
    }
  }

  function handleCategoryChange(nextCategory: DocumentCategory) {
    setCategory(nextCategory)
    if (!isDoctor) {
      setIsClinical(false)
      return
    }
    if (CLINICAL_CATEGORY_SET.has(nextCategory)) {
      setIsClinical(true)
    }
  }

  async function handleUploadSubmit(e: FormEvent) {
    e.preventDefault()
    setUploadError(null)

    const fileErr = validateUploadFile(selectedFile)
    if (fileErr || !selectedFile) {
      setUploadError(fileErr ?? 'Please select a file to upload.')
      return
    }

    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setUploadError('Please enter a document title.')
      return
    }
    if (cleanTitle.length > 160) {
      setUploadError('Document title must be 160 characters or fewer.')
      return
    }

    const effectiveClinical = isDoctor
      ? CLINICAL_CATEGORY_SET.has(category) || isClinical
      : false

    try {
      await uploadMutation.mutateAsync({
        file: selectedFile,
        title: cleanTitle,
        category,
        is_clinical: effectiveClinical,
        notes: notes.trim() || null,
      })
      setUploadOpen(false)
      toast.success(`Uploaded "${cleanTitle}" successfully.`)
    } catch (err) {
      setUploadError(errorMessageOf(err, 'Failed to upload document.'))
    }
  }

  async function handleConfirmArchive() {
    if (!archiveTarget) return
    setArchiveError(null)
    try {
      await archiveMutation.mutateAsync(archiveTarget.id)
      const archivedTitle = archiveTarget.title
      setArchiveTarget(null)
      toast.success(`Archived "${archivedTitle}".`)
    } catch (err) {
      setArchiveError(errorMessageOf(err, 'Failed to archive document.'))
    }
  }

  const isClinicalCategoryLocked = isDoctor && CLINICAL_CATEGORY_SET.has(category)

  return (
    <section className="space-y-4" aria-label="Patient documents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Documents &amp; Attachments</h2>
          <p className="mt-1 text-xs text-slate-600">
            {isDoctor
              ? 'Clinical reports, imaging, referrals, and administrative documents'
              : 'Referrals, identity proofs, insurance records, and administrative attachments'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-[#8E1C3D]"
            />
            Show archived
          </label>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
          >
            <IconRefresh className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>

          {canUpload && (
            <button
              type="button"
              onClick={openUploadModal}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-[#8E1C3D] px-4 text-xs font-semibold text-white shadow-2xs hover:bg-[#731632] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
            >
              <IconUpload className="h-4 w-4" aria-hidden="true" />
              Upload Document
            </button>
          )}
        </div>
      </div>

      {isPending ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600" role="status">
          Loading patient documents…
        </div>
      ) : isError ? (
        <InlineAlert tone="error">
          Unable to load documents: {errorMessageOf(error, 'Request failed.')}
        </InlineAlert>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <IconNotes className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-800">
            {showArchived ? 'No documents found for this patient' : 'No active documents attached'}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {canUpload
              ? 'Upload PDF reports or JPEG/PNG scans up to 10 MB.'
              : 'Uploaded patient documents will appear here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3">Document</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Size</th>
                <th scope="col" className="px-4 py-3">Uploaded By</th>
                <th scope="col" className="px-4 py-3">Uploaded (IST)</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => {
                const badge = getCategoryBadge(doc.category)
                const isImg = isImageMime(doc.mime_type)
                const isBusy = loadingDocId === doc.id
                const showArchive = canArchiveDocument(doc)

                return (
                  <tr
                    key={doc.id}
                    className={doc.is_archived ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{doc.title}</span>
                        {isDoctor && doc.is_clinical && (
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-900">
                            Clinical
                          </span>
                        )}
                        {doc.is_archived && (
                          <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            Archived
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-slate-600">
                        {doc.original_filename}
                      </p>
                      {(doc.visit_code || (isDoctor && doc.encounter_code)) && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {doc.visit_code && (
                            <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                              {doc.visit_code}
                            </span>
                          )}
                          {isDoctor && doc.encounter_code && (
                            <span className="inline-flex items-center rounded bg-purple-50 px-1.5 py-0.5 font-mono text-xs text-purple-900">
                              {doc.encounter_code}
                            </span>
                          )}
                        </div>
                      )}
                      {doc.notes && (
                        <p className="mt-1 text-xs text-slate-600">{doc.notes}</p>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 align-top text-xs font-medium text-slate-700">
                      {formatFileSize(doc.file_size_bytes)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-slate-700">
                      {doc.uploaded_by_username ? `@${doc.uploaded_by_username}` : `User #${doc.uploaded_by_user_id}`}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-slate-600">
                      {formatIst(doc.created_at)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePreviewOrOpen(doc)}
                          disabled={isBusy}
                          className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
                        >
                          <IconEye className="h-3.5 w-3.5" aria-hidden="true" />
                          {isBusy ? 'Opening…' : isImg ? 'Preview' : 'Open PDF'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDirectDownload(doc)}
                          disabled={isBusy}
                          aria-label={`Download ${doc.title}`}
                          className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
                        >
                          Download
                        </button>

                        {showArchive && (
                          <button
                            type="button"
                            onClick={() => {
                              setArchiveError(null)
                              setArchiveTarget(doc)
                            }}
                            aria-label={`Archive ${doc.title}`}
                            className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-900 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-800"
                          >
                            <IconTrash className="h-3.5 w-3.5" aria-hidden="true" />
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Document Modal */}
      <Modal
        open={uploadOpen}
        onClose={closeUploadModal}
        title="Upload Patient Document"
        description="Attach a PDF, JPEG, or PNG file (maximum 10 MB)."
        variant="info"
        busy={uploadMutation.isPending}
        className="max-w-lg"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4">
          {uploadError && <InlineAlert tone="error">{uploadError}</InlineAlert>}

          <div>
            <label htmlFor="doc-upload-file" className={LABEL_CLASS}>
              File (PDF, JPEG, PNG — max 10 MB) *
            </label>
            <input
              ref={fileInputRef}
              id="doc-upload-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={handleFileChange}
              required
              className="block min-h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-800 hover:file:bg-slate-200"
            />
            {selectedFile && (
              <p className="mt-1 text-xs text-slate-600">
                Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}
          </div>

          <div>
            <label htmlFor="doc-upload-title" className={LABEL_CLASS}>
              Document Title *
            </label>
            <input
              id="doc-upload-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
              placeholder="e.g., Referral Letter or CBC Report"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="doc-upload-category" className={LABEL_CLASS}>
              Category *
            </label>
            <select
              id="doc-upload-category"
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value as DocumentCategory)}
              className={INPUT_CLASS}
            >
              {isDoctor ? (
                <>
                  <optgroup label="Clinical">
                    {CLINICAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_META[cat].label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Administrative &amp; General">
                    {NON_CLINICAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_META[cat].label}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                NON_CLINICAL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))
              )}
            </select>
          </div>

          {isDoctor && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-slate-800">
                <input
                  id="doc-upload-clinical"
                  type="checkbox"
                  checked={isClinicalCategoryLocked || isClinical}
                  disabled={isClinicalCategoryLocked}
                  onChange={(e) => setIsClinical(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#8E1C3D]"
                />
                <span>
                  Mark as clinical (doctor-only visibility)
                  {isClinicalCategoryLocked && (
                    <span className="mt-0.5 block text-xs font-normal text-slate-600">
                      Clinical categories are always restricted to doctors.
                    </span>
                  )}
                </span>
              </label>
            </div>
          )}

          <div>
            <label htmlFor="doc-upload-notes" className={LABEL_CLASS}>
              Notes (optional)
            </label>
            <textarea
              id="doc-upload-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context or remarks"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={closeUploadModal}
              disabled={uploadMutation.isPending}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploadMutation.isPending}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#731632] disabled:opacity-50"
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload Document'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Safe Image Preview Modal (img-src 'self' blob:) */}
      <Modal
        open={imagePreview !== null}
        onClose={closeImagePreview}
        title={imagePreview?.doc.title ?? 'Document Preview'}
        description={imagePreview?.filename}
        variant="info"
        dismiss="any"
        className="max-w-3xl"
      >
        {imagePreview && (
          <div className="space-y-4">
            <div className="flex justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
              <img
                src={imagePreview.url}
                alt={imagePreview.doc.title}
                className="max-h-[65vh] w-auto max-w-full rounded object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <span className="text-xs text-slate-600">
                {formatFileSize(imagePreview.doc.file_size_bytes)} · Uploaded{' '}
                {formatIst(imagePreview.doc.created_at)}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={imagePreview.url}
                  download={imagePreview.filename}
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Download Image
                </a>
                <button
                  type="button"
                  onClick={closeImagePreview}
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-slate-800 px-3.5 text-xs font-semibold text-white hover:bg-slate-900"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Archive Confirmation Modal (native <dialog>, never window.confirm) */}
      <Modal
        open={archiveTarget !== null}
        onClose={() => {
          if (!archiveMutation.isPending) {
            setArchiveTarget(null)
            setArchiveError(null)
          }
        }}
        title="Archive Document"
        description="Archived documents are hidden from the active list but preserved for audit records."
        variant="destructive"
        busy={archiveMutation.isPending}
        className="max-w-md"
      >
        {archiveTarget && (
          <div className="space-y-4">
            {archiveError && <InlineAlert tone="error">{archiveError}</InlineAlert>}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{archiveTarget.title}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-600">
                {archiveTarget.original_filename}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setArchiveTarget(null)
                  setArchiveError(null)
                }}
                disabled={archiveMutation.isPending}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                disabled={archiveMutation.isPending}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-red-800 px-4 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Archive Document'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
