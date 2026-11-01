import { useState, useRef, type ChangeEvent } from 'react'

interface PhotoUploaderProps {
  onPhotoSelected: (file: File | null) => void
  disabled?: boolean
}

export function PhotoUploader({ onPhotoSelected, disabled = false }: PhotoUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
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

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-neutral-700">
        Patient Photograph (Optional)
      </label>
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded border border-neutral-300 bg-neutral-100 flex items-center justify-center overflow-hidden">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Patient preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs text-neutral-400 text-center px-1">
              No photo
            </span>
          )}
        </div>

        <div className="space-y-2">
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
          <p className="text-xs text-neutral-500">Max size 5 MB. JPEG or PNG only.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 font-medium">
          {error}
        </p>
      )}
    </div>
  )
}
