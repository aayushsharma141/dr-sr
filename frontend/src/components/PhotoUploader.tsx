import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

interface PhotoUploaderProps {
  onPhotoSelected: (file: File | null) => void
  disabled?: boolean
}

/** Passport photo ratio used on the printed registration card (35 mm x 45 mm). */
export const PHOTO_RATIO = 35 / 45
/** Stored photos are capped at this height so backups stay small. */
export const PHOTO_MAX_HEIGHT = 720
const JPEG_QUALITY = 0.88

export interface CropRect {
  sx: number
  sy: number
  sw: number
  sh: number
  outWidth: number
  outHeight: number
}

/** Centre-crop a source frame to the passport ratio without stretching, capped in size. */
export function passportCrop(srcWidth: number, srcHeight: number): CropRect {
  let sw = srcWidth
  let sh = srcHeight
  if (srcWidth / srcHeight > PHOTO_RATIO) {
    sw = Math.round(srcHeight * PHOTO_RATIO)
  } else {
    sh = Math.round(srcWidth / PHOTO_RATIO)
  }
  const sx = Math.floor((srcWidth - sw) / 2)
  const sy = Math.floor((srcHeight - sh) / 2)
  const scale = sh > PHOTO_MAX_HEIGHT ? PHOTO_MAX_HEIGHT / sh : 1
  return {
    sx,
    sy,
    sw,
    sh,
    outWidth: Math.round(sw * scale),
    outHeight: Math.round(sh * scale),
  }
}

type CameraMode = 'idle' | 'starting' | 'live' | 'captured'

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access in the browser, or use Upload photo.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this computer. Connect a webcam, or use Upload photo.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The camera is busy in another program. Close it and try again, or use Upload photo.'
  }
  return 'The camera could not be started. Use Upload photo instead.'
}

function cameraUnavailableReason(): string | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot use the camera. Use Upload photo.'
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'The camera needs a secure (HTTPS) connection to the server. Use Upload photo, or ask the administrator to enable HTTPS.'
  }
  return null
}

export function PhotoUploader({ onPhotoSelected, disabled = false }: PhotoUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<CameraMode>('idle')
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const capturedFileRef = useRef<File | null>(null)
  const mountedRef = useRef(true)

  const unavailableReason = cameraUnavailableReason()

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  // Always release the camera and any object URLs when the component goes away.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl)
    }
  }, [capturedUrl])

  // Attach the stream once the <video> element exists.
  useEffect(() => {
    if (mode !== 'live' || !videoRef.current || !streamRef.current) return
    const video = videoRef.current
    video.srcObject = streamRef.current
    void video.play?.()?.catch(() => {})
  }, [mode])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setPreviewUrl(null)
      onPhotoSelected(null)
      return
    }

    // Validate mime type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Only JPEG and PNG photos are supported.')
      setPreviewUrl(null)
      onPhotoSelected(null)
      return
    }

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Photo exceeds 5 MB limit. Please select a smaller photo.')
      setPreviewUrl(null)
      onPhotoSelected(null)
      return
    }

    setPreviewUrl(URL.createObjectURL(file))
    onPhotoSelected(file)
  }

  const handleClear = () => {
    setPreviewUrl(null)
    setError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
    onPhotoSelected(null)
  }

  const openCamera = async () => {
    setError(null)
    const reason = cameraUnavailableReason()
    if (reason) {
      setError(reason)
      return
    }
    setMode('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setMode('live')
    } catch (err) {
      if (!mountedRef.current) return
      stopCamera()
      setMode('idle')
      setError(cameraErrorMessage(err))
    }
  }

  const closeCamera = () => {
    stopCamera()
    capturedFileRef.current = null
    setCapturedUrl(null)
    setMode('idle')
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Wait a moment and try again.')
      return
    }
    const crop = passportCrop(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = crop.outWidth
    canvas.height = crop.outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('The photo could not be captured. Use Upload photo instead.')
      return
    }
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.outWidth, crop.outHeight)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('The photo could not be captured. Use Upload photo instead.')
          return
        }
        capturedFileRef.current = new File([blob], 'webcam-photo.jpg', { type: 'image/jpeg' })
        stopCamera() // release the camera as soon as the picture is taken
        setCapturedUrl(URL.createObjectURL(blob))
        setMode('captured')
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  }

  const retake = async () => {
    capturedFileRef.current = null
    setCapturedUrl(null)
    await openCamera()
  }

  const usePhoto = () => {
    const file = capturedFileRef.current
    if (!file) return
    if (inputRef.current) inputRef.current.value = ''
    setPreviewUrl(URL.createObjectURL(file))
    onPhotoSelected(file)
    capturedFileRef.current = null
    setCapturedUrl(null)
    setMode('idle')
  }

  const buttonBase =
    'px-3 py-1.5 rounded text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-red-800'

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-700">
        Patient Photograph (Optional)
      </label>
      <div className="flex items-start gap-4">
        <div className="w-24 h-32 rounded border border-neutral-300 bg-neutral-100 flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Patient preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs text-neutral-600 text-center px-1">
              No photo
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCamera}
              disabled={disabled || mode !== 'idle'}
              className={`${buttonBase} bg-red-900 text-white hover:bg-red-800`}
            >
              {mode === 'starting' ? 'Starting camera…' : 'Take photo'}
            </button>
            <input
              ref={inputRef}
              id="patient-photo-input"
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileChange}
              disabled={disabled}
              aria-label="Patient Photograph"
              className="block text-sm text-neutral-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-900 hover:file:bg-red-100 cursor-pointer disabled:opacity-50"
            />
          </div>
          {previewUrl && (
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="text-xs text-red-700 hover:underline font-medium cursor-pointer"
            >
              Remove photo
            </button>
          )}
          <p className="text-xs text-neutral-500">
            Max size 5 MB. JPEG or PNG only. The camera starts only when you press Take photo.
          </p>
          {unavailableReason && mode === 'idle' && (
            <p className="text-xs text-neutral-500">{unavailableReason}</p>
          )}
        </div>
      </div>

      {(mode === 'live' || mode === 'captured') && (
        <div
          role="group"
          aria-label="Camera"
          className="max-w-sm space-y-2 rounded border border-neutral-300 bg-neutral-50 p-3"
        >
          {mode === 'live' ? (
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Camera preview"
              className="w-full rounded bg-black"
            />
          ) : (
            capturedUrl && (
              <img
                src={capturedUrl}
                alt="Captured photo preview"
                className="mx-auto h-64 rounded bg-black object-contain"
              />
            )
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeCamera}
              className={`${buttonBase} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100`}
            >
              Cancel
            </button>
            {mode === 'live' ? (
              <button
                type="button"
                onClick={capture}
                className={`${buttonBase} bg-red-900 text-white hover:bg-red-800`}
              >
                Capture
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={retake}
                  className={`${buttonBase} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100`}
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={usePhoto}
                  className={`${buttonBase} bg-red-900 text-white hover:bg-red-800`}
                >
                  Use this photo
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  )
}
