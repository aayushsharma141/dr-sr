import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Modal } from './Modal'
import { InlineAlert } from './InlineAlert'
import {
  IconCamera,
  IconCheck,
  IconPhoto,
  IconRefresh,
  IconUpload,
} from './icons'

export interface PatientPhotoModalProps {
  open: boolean
  onClose: () => void
  onPhotoSelected: (file: File) => void
  currentPreview?: string | null
}

type StepMode = 'select' | 'capture' | 'upload'

const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB (backend limit)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function PatientPhotoModal({
  open,
  onClose,
  onPhotoSelected,
  currentPreview,
}: PatientPhotoModalProps) {
  const [mode, setMode] = useState<StepMode>('select')

  // Webcam state
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [capturedFile, setCapturedFile] = useState<File | null>(null)
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Cleanup active video stream tracks
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraLoading(false)
  }

  // Revoke created object URLs on reset
  const cleanupPreviews = () => {
    if (capturedPreview && capturedPreview.startsWith('blob:')) {
      URL.revokeObjectURL(capturedPreview)
    }
    if (uploadPreview && uploadPreview.startsWith('blob:')) {
      URL.revokeObjectURL(uploadPreview)
    }
  }

  const resetAllState = () => {
    stopCamera()
    cleanupPreviews()
    setMode('select')
    setCameraError(null)
    setCapturedFile(null)
    setCapturedPreview(null)
    setUploadFile(null)
    setUploadPreview(null)
    setUploadError(null)
    setIsDragging(false)
  }

  const handleClose = () => {
    resetAllState()
    onClose()
  }

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!open) {
      resetAllState()
    }
  }, [open])

  // Camera lifecycle when mode changes to 'capture'
  useEffect(() => {
    if (!open || mode !== 'capture') {
      stopCamera()
      return
    }

    let isSubscribed = true

    const initCamera = async () => {
      setCameraLoading(true)
      setCameraError(null)

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (isSubscribed) {
          setCameraLoading(false)
          setCameraError(
            'Webcam is not supported by this browser or connection. You can use the upload option instead.',
          )
        }
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 960 },
            facingMode: 'user',
          },
          audio: false,
        })

        if (!isSubscribed) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch {
            // Autoplay policies might throw if unmuted/unmounted
          }
        }
        setCameraLoading(false)
      } catch (err: unknown) {
        if (!isSubscribed) return
        setCameraLoading(false)
        const error = err as { name?: string; message?: string }
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          setCameraError('Camera access was denied. Please allow camera permissions in your browser or upload a file.')
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          setCameraError('No webcam device was found. Please ensure your camera is connected.')
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          setCameraError('Camera is already in use by another application. Please close other software using the camera.')
        } else {
          setCameraError(error.message || 'Unable to access the camera.')
        }
      }
    }

    void initCamera()

    return () => {
      isSubscribed = false
      stopCamera()
    }
  }, [open, mode])

  // Snap photo from video feed
  const handleSnap = () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement('canvas')
    const width = video.videoWidth || 640
    const height = video.videoHeight || 480
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, width, height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `patient-photo-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })
        const previewUrl = URL.createObjectURL(blob)
        setCapturedFile(file)
        setCapturedPreview(previewUrl)
      },
      'image/jpeg',
      0.92,
    )
  }

  const handleRetake = () => {
    if (capturedPreview && capturedPreview.startsWith('blob:')) {
      URL.revokeObjectURL(capturedPreview)
    }
    setCapturedFile(null)
    setCapturedPreview(null)
  }

  const handleConfirmCapture = () => {
    if (capturedFile) {
      stopCamera()
      onPhotoSelected(capturedFile)
      handleClose()
    }
  }

  // Validate and stage an uploaded file
  const processUploadFile = (file: File) => {
    setUploadError(null)

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setUploadError('Unsupported file format. Please choose a JPEG or PNG image.')
      return
    }

    if (file.size > MAX_FILE_BYTES) {
      setUploadError(
        `File is too large (${formatFileSize(file.size)}). Maximum allowed size is 5 MB.`,
      )
      return
    }

    if (uploadPreview && uploadPreview.startsWith('blob:')) {
      URL.revokeObjectURL(uploadPreview)
    }

    setUploadFile(file)
    setUploadPreview(URL.createObjectURL(file))
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processUploadFile(file)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      processUploadFile(file)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleConfirmUpload = () => {
    if (uploadFile && !uploadError) {
      onPhotoSelected(uploadFile)
      handleClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        mode === 'select'
          ? 'Add Patient Photo'
          : mode === 'capture'
            ? 'Capture Patient Photo'
            : 'Upload Patient Photo'
      }
      description={
        mode === 'select'
          ? 'Choose whether to capture a new photo with the webcam or upload a file from this PC.'
          : mode === 'capture'
            ? 'Center the patient inside the frame and take a clear photo.'
            : 'Select or drop a JPEG or PNG image file (maximum 5 MB).'
      }
      variant="info"
      dismiss="closerequest"
      className="max-w-xl"
    >
      <div className="space-y-4">
        {/* ================= STEP 1: OPTION SELECTION ================= */}
        {mode === 'select' && (
          <div className="py-2 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Option 1: Capture with Webcam (Primary) */}
              <button
                type="button"
                data-autofocus
                onClick={() => setMode('capture')}
                className="group relative flex flex-col items-center justify-between rounded-2xl border-2 border-[#5D0B26] bg-[#5D0B26]/5 p-5 text-center transition-all hover:bg-[#5D0B26]/10 hover:shadow-md focus-visible:outline-2 focus-visible:outline-[#5D0B26] cursor-pointer min-h-[160px]"
              >
                <span className="absolute top-3 right-3 rounded-full bg-[#5D0B26] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                  Primary
                </span>
                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5D0B26] text-white shadow-sm transition-transform group-hover:scale-105">
                    <IconCamera className="h-7 w-7" />
                  </div>
                  <h3 className="mt-3 text-base font-bold text-[#5D0B26]">
                    Capture with Webcam
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Take a live photo using the connected camera
                  </p>
                </div>
                <span className="mt-3 inline-flex items-center text-xs font-bold text-[#5D0B26] group-hover:underline">
                  Start Camera &rarr;
                </span>
              </button>

              {/* Option 2: Upload File (Secondary) */}
              <button
                type="button"
                onClick={() => setMode('upload')}
                className="group relative flex flex-col items-center justify-between rounded-2xl border border-slate-300 bg-white p-5 text-center transition-all hover:border-slate-400 hover:bg-slate-50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#5D0B26] cursor-pointer min-h-[160px]"
              >
                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 shadow-xs transition-transform group-hover:scale-105">
                    <IconUpload className="h-7 w-7" />
                  </div>
                  <h3 className="mt-3 text-base font-bold text-slate-900">
                    Upload from Computer
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Select a JPEG or PNG file from this computer
                  </p>
                </div>
                <span className="mt-3 inline-flex items-center text-xs font-semibold text-slate-700 group-hover:underline">
                  Browse Files &rarr;
                </span>
              </button>
            </div>

            {currentPreview && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <img
                  src={currentPreview}
                  alt="Current patient preview"
                  className="h-12 w-12 rounded-lg object-cover border border-slate-300"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800">Current Photo Active</p>
                  <p className="text-xs text-slate-500 truncate">
                    Choosing a new photo will replace this picture.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleClose}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2A: CAPTURE SCREEN ================= */}
        {mode === 'capture' && (
          <div className="space-y-4">
            {cameraError && (
              <InlineAlert tone="error" className="mb-2">
                <div className="space-y-2">
                  <p className="font-semibold">{cameraError}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMode('upload')}
                      className="min-h-10 inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-900 cursor-pointer"
                    >
                      <IconUpload className="h-4 w-4" /> Switch to File Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraError(null)
                        setMode('select')
                      }}
                      className="min-h-10 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
                    >
                      Back to Options
                    </button>
                  </div>
                </div>
              </InlineAlert>
            )}

            <div className="relative mx-auto aspect-4/3 w-full max-w-md overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center border-2 border-slate-800 shadow-inner">
              {cameraLoading && !cameraError && (
                <div className="flex flex-col items-center gap-2 text-slate-200">
                  <IconCamera className="h-8 w-8 animate-pulse text-slate-200" />
                  <p className="text-xs font-medium">Connecting to webcam…</p>
                </div>
              )}

              {/* Live Video Feed. It stays mounted (hidden) while a snapshot is shown: the stream
                  is attached to this element once, so a remounted one left Retake with a black feed. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${cameraLoading || cameraError || capturedPreview ? 'hidden' : 'block'}`}
              />


              {/* Captured Photo Preview */}
              {capturedPreview && (
                <img
                  src={capturedPreview}
                  alt="Captured snapshot preview"
                  className="h-full w-full object-cover"
                />
              )}

              {/* Centering frame guide for live capture */}
              {!capturedPreview && !cameraLoading && !cameraError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-48 w-40 rounded-full border-2 border-dashed border-white/60 shadow-xs" />
                  <span className="absolute bottom-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white/90">
                    Align patient face within circle
                  </span>
                </div>
              )}
            </div>

            {/* Actions for Capture Screen */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  stopCamera()
                  setMode('select')
                }}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Back to Options
              </button>

              <div className="flex items-center gap-2">
                {!capturedPreview ? (
                  <button
                    type="button"
                    disabled={cameraLoading || !!cameraError}
                    onClick={handleSnap}
                    className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[#5D0B26] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#7A0E32] focus-visible:outline-2 focus-visible:outline-[#5D0B26] disabled:opacity-50 cursor-pointer"
                  >
                    <IconCamera className="h-5 w-5" /> Take Snapshot
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleRetake}
                      className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <IconRefresh className="h-4 w-4" /> Retake
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmCapture}
                      className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700 cursor-pointer"
                    >
                      <IconCheck className="h-5 w-5" /> Use This Photo
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 2B: UPLOAD SCREEN ================= */}
        {mode === 'upload' && (
          <div className="space-y-4">
            {uploadError && (
              <InlineAlert tone="error" onDismiss={() => setUploadError(null)}>
                {uploadError}
              </InlineAlert>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              aria-label="Upload Photo File"
              onChange={handleFileInputChange}
              className="hidden"
            />

            {!uploadPreview ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer min-h-[200px] ${
                  isDragging
                    ? 'border-[#5D0B26] bg-[#5D0B26]/10'
                    : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-100/70'
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click()
                  }
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm border border-slate-200">
                  <IconPhoto className="h-7 w-7 text-slate-500" />
                </div>
                <p className="mt-3 text-sm font-bold text-slate-900">
                  Click to browse or drag and drop image here
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Accepted formats: JPEG or PNG (maximum 5 MB)
                </p>
                <button
                  type="button"
                  className="mt-4 min-h-10 rounded-xl bg-slate-200 px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-300 pointer-events-none"
                >
                  Choose File
                </button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <img
                  src={uploadPreview}
                  alt="Selected photo preview"
                  className="h-32 w-32 rounded-xl object-cover border border-slate-300 shadow-xs"
                />
                <div className="flex-1 space-y-2 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-emerald-800">
                    <IconCheck className="h-4 w-4 text-emerald-700" /> Image Selected
                  </div>
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {uploadFile?.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Size: {uploadFile ? formatFileSize(uploadFile.size) : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadFile(null)
                      if (uploadPreview.startsWith('blob:')) {
                        URL.revokeObjectURL(uploadPreview)
                      }
                      setUploadPreview(null)
                    }}
                    className="min-h-9 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <IconRefresh className="h-3.5 w-3.5" /> Choose Different File
                  </button>
                </div>
              </div>
            )}

            {/* Actions for Upload Screen */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setMode('select')}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Back to Options
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!uploadFile || !!uploadError}
                  onClick={handleConfirmUpload}
                  className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50 cursor-pointer"
                >
                  <IconCheck className="h-5 w-5" /> Use This Photo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
