import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoUploader, passportCrop, PHOTO_RATIO, PHOTO_MAX_HEIGHT } from '../PhotoUploader'

function fakeStream() {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

describe('passportCrop', () => {
  it.each([
    [1280, 720],
    [640, 640],
    [400, 900],
  ])('crops %ix%i to the 35:45 ratio without stretching', (w, h) => {
    const crop = passportCrop(w, h)
    expect(Math.abs(crop.sw / crop.sh - PHOTO_RATIO)).toBeLessThan(0.01)
    expect(crop.sx).toBeGreaterThanOrEqual(0)
    expect(crop.sy).toBeGreaterThanOrEqual(0)
    expect(crop.sx + crop.sw).toBeLessThanOrEqual(w)
    expect(crop.sy + crop.sh).toBeLessThanOrEqual(h)
    expect(crop.outHeight).toBeLessThanOrEqual(PHOTO_MAX_HEIGHT)
  })
})

describe('PhotoUploader webcam capture', () => {
  const getUserMedia = vi.fn()

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as never
    HTMLCanvasElement.prototype.toBlob = ((cb: BlobCallback) => {
      cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }))
    }) as never
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    getUserMedia.mockReset()
  })

  it('starts the camera only when asked, captures, and hands back a JPEG file', async () => {
    const { stream, stop } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const onPhotoSelected = vi.fn()
    render(<PhotoUploader onPhotoSelected={onPhotoSelected} />)

    expect(getUserMedia).not.toHaveBeenCalled() // never auto-starts

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await screen.findByLabelText('Camera preview')
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    await screen.findByAltText('Captured photo preview')
    expect(stop).toHaveBeenCalled() // camera released once the picture is taken
    expect(onPhotoSelected).not.toHaveBeenCalled() // staff must confirm first

    fireEvent.click(screen.getByRole('button', { name: 'Use this photo' }))
    expect(onPhotoSelected).toHaveBeenCalledTimes(1)
    const file = onPhotoSelected.mock.calls[0][0] as File
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toBe('webcam-photo.jpg')
    expect(screen.getByAltText('Patient preview')).toBeInTheDocument()
  })

  it('lets staff retake and cancel, releasing the camera each time', async () => {
    const first = fakeStream()
    const second = fakeStream()
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const onPhotoSelected = vi.fn()
    render(<PhotoUploader onPhotoSelected={onPhotoSelected} />)

    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await screen.findByLabelText('Camera preview')
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    await screen.findByAltText('Captured photo preview')

    fireEvent.click(screen.getByRole('button', { name: 'Retake' }))
    await screen.findByLabelText('Camera preview')
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(second.stop).toHaveBeenCalled()
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument()
    expect(onPhotoSelected).not.toHaveBeenCalled()
  })

  it('releases the camera if the form is closed while it is live', async () => {
    const { stream, stop } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { unmount } = render(<PhotoUploader onPhotoSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await screen.findByLabelText('Camera preview')
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it.each([
    ['NotAllowedError', /permission was denied/i],
    ['NotFoundError', /no camera was found/i],
    ['NotReadableError', /busy in another program/i],
  ])('shows a clear message for %s and keeps upload available', async (name, message) => {
    getUserMedia.mockRejectedValue(new DOMException('x', name))
    render(<PhotoUploader onPhotoSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message))
    expect(screen.getByLabelText('Patient Photograph')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled()
  })

  it('explains HTTPS when the page is not a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    render(<PhotoUploader onPhotoSelected={vi.fn()} />)
    expect(screen.getByText(/needs a secure \(HTTPS\) connection/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/HTTPS/)
  })

  it('disables the camera button while the form is saving', () => {
    render(<PhotoUploader onPhotoSelected={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled()
  })
})
