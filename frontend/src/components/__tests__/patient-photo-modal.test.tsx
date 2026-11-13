import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '../../test/dialog-shim'
import { PatientPhotoModal } from '../PatientPhotoModal'

describe('PatientPhotoModal', () => {
  const mockOnClose = vi.fn()
  const mockOnPhotoSelected = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockOnClose.mockReset()
    mockOnPhotoSelected.mockReset()
    // Mock URL.createObjectURL and URL.revokeObjectURL
    globalThis.URL.createObjectURL = vi.fn((_file: Blob | MediaSource) => 'blob:mock-preview-url')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the initial selection screen with primary Capture and secondary Upload options', () => {
    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Add Patient Photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /capture with webcam/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload from computer/i })).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('navigates to webcam capture screen in the same popup when Capture option is selected', async () => {
    const mockTrack = { stop: vi.fn() }
    const mockStream = {
      getTracks: () => [mockTrack],
    }

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    })

    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /capture with webcam/i }))

    expect(screen.getByRole('heading', { name: 'Capture Patient Photo' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take snapshot/i })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: /back to options/i })).toBeInTheDocument()

    // Back to options returns to select screen
    fireEvent.click(screen.getByRole('button', { name: /back to options/i }))
    expect(screen.getByRole('heading', { name: 'Add Patient Photo' })).toBeInTheDocument()
    expect(mockTrack.stop).toHaveBeenCalled()
  })

  it('captures a snapshot from the webcam, shows retake and use photo options, and confirms', async () => {
    const mockTrack = { stop: vi.fn() }
    const mockStream = {
      getTracks: () => [mockTrack],
    }

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
      writable: true,
      configurable: true,
    })

    // Mock canvas context and toBlob
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }) as any
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      _type?: string,
      _quality?: unknown,
    ) {
      cb(new Blob(['snapshot-jpeg-data'], { type: 'image/jpeg' }))
    })

    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /capture with webcam/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take snapshot/i })).toBeEnabled()
    })

    // Click Take Snapshot
    fireEvent.click(screen.getByRole('button', { name: /take snapshot/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /use this photo/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument()
    })

    // Click Use This Photo
    fireEvent.click(screen.getByRole('button', { name: /use this photo/i }))

    expect(mockOnPhotoSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'image/jpeg',
      }),
    )
    expect(mockOnClose).toHaveBeenCalled()
  })

  // Retake used to mount a fresh <video> with no stream, so the feed went black and the
  // next snapshot was a blank frame.
  it('keeps the camera feed attached after Retake so the next snapshot is not blank', async () => {
    const mockStream = { getTracks: () => [{ stop: vi.fn() }] }
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
      writable: true,
      configurable: true,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['snapshot-jpeg-data'], { type: 'image/jpeg' }))
    })

    const { container } = render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )
    const liveFeed = () => container.querySelector('video') as HTMLVideoElement | null

    fireEvent.click(screen.getByRole('button', { name: /capture with webcam/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take snapshot/i })).toBeEnabled()
    })
    expect(liveFeed()?.srcObject).toBe(mockStream)

    fireEvent.click(screen.getByRole('button', { name: /take snapshot/i }))
    fireEvent.click(await screen.findByRole('button', { name: /retake/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /take snapshot/i })).toBeEnabled()
    })
    expect(liveFeed()?.srcObject).toBe(mockStream)
    expect(liveFeed()).not.toHaveClass('hidden')
  })

  it('shows honest error banner and switch-to-upload button if camera is unavailable', async () => {
    // MediaDevices throws NotAllowedError
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue({
          name: 'NotAllowedError',
          message: 'Permission denied',
        }),
      },
      writable: true,
      configurable: true,
    })

    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /capture with webcam/i }))

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /switch to file upload/i })).toBeInTheDocument()

    // Clicking switch to file upload transitions to upload screen
    fireEvent.click(screen.getByRole('button', { name: /switch to file upload/i }))
    expect(screen.getByRole('heading', { name: 'Upload Patient Photo' })).toBeInTheDocument()
  })

  it('navigates to upload screen, stages valid image, and confirms photo', async () => {
    const user = userEvent.setup()
    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /upload from computer/i }))

    expect(screen.getByRole('heading', { name: 'Upload Patient Photo' })).toBeInTheDocument()
    expect(screen.getByText(/click to browse or drag and drop/i)).toBeInTheDocument()

    const validPhoto = new File(['mock-jpeg-bytes'], 'patient_headshot.jpg', {
      type: 'image/jpeg',
    })
    const fileInput = screen.getByLabelText('Upload Photo File')
    await user.upload(fileInput, validPhoto)

    expect(screen.getByText('patient_headshot.jpg')).toBeInTheDocument()
    expect(screen.getByText('Image Selected')).toBeInTheDocument()

    const confirmButton = screen.getByRole('button', { name: /use this photo/i })
    expect(confirmButton).toBeEnabled()

    fireEvent.click(confirmButton)

    expect(mockOnPhotoSelected).toHaveBeenCalledWith(validPhoto)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('rejects files larger than 5 MB on the upload screen', async () => {
    const user = userEvent.setup()
    render(
      <PatientPhotoModal
        open={true}
        onClose={mockOnClose}
        onPhotoSelected={mockOnPhotoSelected}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /upload from computer/i }))

    // Create a dummy file larger than 5 MB
    const largeFile = new File(['x'.repeat(100)], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 })

    const fileInput = screen.getByLabelText('Upload Photo File')
    await user.upload(fileInput, largeFile)

    expect(screen.getByText(/file is too large/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use this photo/i })).toBeDisabled()
    expect(mockOnPhotoSelected).not.toHaveBeenCalled()
  })
})

