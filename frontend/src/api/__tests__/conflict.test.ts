import { describe, expect, it } from 'vitest'
import { ApiError, isVersionConflict } from '../client'

describe('isVersionConflict', () => {
  it('accepts a 409 version_conflict', () => {
    expect(isVersionConflict(new ApiError(409, 'version_conflict', 'Record changed'))).toBe(true)
  })

  it('rejects validation, permission, network and unrelated 409 errors', () => {
    expect(isVersionConflict(new ApiError(409, 'role_change_not_allowed', 'Not a version clash'))).toBe(false)
    expect(isVersionConflict(new ApiError(400, 'validation_error', 'Required field missing'))).toBe(false)
    expect(isVersionConflict(new ApiError(403, 'forbidden', 'Missing permission'))).toBe(false)
    expect(isVersionConflict(new ApiError(500, 'internal_error', 'Server failed'))).toBe(false)
    expect(isVersionConflict(new Error('Failed to fetch'))).toBe(false)
    expect(isVersionConflict(null)).toBe(false)
    expect(isVersionConflict(undefined)).toBe(false)
  })
})
