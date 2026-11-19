import { useEffect, useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconCheck,
  IconNotes,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from './icons'
import {
  useCreateQuickPhrase,
  useDeleteQuickPhrase,
  useQuickPhrases,
  useUpdateQuickPhrase,
} from '../api/queries'
import type { QuickPhraseOut, QuickPhraseSection } from '../api/types'

export interface QuickPhraseBarProps {
  departmentId: number | null
  section?: QuickPhraseSection
  onSelectPhrase: (phrase: string) => void
  readOnly?: boolean
}

const MIN_PHRASE_LENGTH = 2
const MAX_PHRASE_LENGTH = 240
const SEARCH_THRESHOLD = 8

function PencilIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message
  }
  return fallback
}

export function QuickPhraseBar({
  departmentId,
  section = 'COMPLAINTS',
  onSelectPhrase,
  readOnly = false,
}: QuickPhraseBarProps) {
  const phrasesQuery = useQuickPhrases(departmentId, section)
  const createMutation = useCreateQuickPhrase()
  const updateMutation = useUpdateQuickPhrase()
  const deleteMutation = useDeleteQuickPhrase()

  const [isAdding, setIsAdding] = useState(false)
  const [newPhraseText, setNewPhraseText] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')

  // Reset transient inputs when department or section changes so prior context never leaks.
  useEffect(() => {
    setIsAdding(false)
    setNewPhraseText('')
    setAddError(null)
    setEditingId(null)
    setEditText('')
    setEditError(null)
    setConfirmDeleteId(null)
    setDeleteError(null)
    setSearchQuery('')
  }, [departmentId, section])

  const defaults = useMemo<QuickPhraseOut[]>(
    () => (Array.isArray(phrasesQuery.data?.defaults) ? phrasesQuery.data.defaults : []),
    [phrasesQuery.data],
  )
  const personal = useMemo<QuickPhraseOut[]>(
    () => (Array.isArray(phrasesQuery.data?.personal) ? phrasesQuery.data.personal : []),
    [phrasesQuery.data],
  )

  const totalCount = defaults.length + personal.length
  const showSearch = totalCount > SEARCH_THRESHOLD
  const normalizedSearch = searchQuery.trim().toLowerCase()

  const filteredDefaults = useMemo(
    () =>
      normalizedSearch
        ? defaults.filter((p) => p.phrase_text.toLowerCase().includes(normalizedSearch))
        : defaults,
    [defaults, normalizedSearch],
  )

  const filteredPersonal = useMemo(
    () =>
      normalizedSearch
        ? personal.filter((p) => p.phrase_text.toLowerCase().includes(normalizedSearch))
        : personal,
    [personal, normalizedSearch],
  )

  const handleOpenAdd = () => {
    setIsAdding(true)
    setAddError(null)
    setEditingId(null)
    setEditError(null)
    setConfirmDeleteId(null)
    setDeleteError(null)
  }

  const handleCancelAdd = () => {
    setIsAdding(false)
    setNewPhraseText('')
    setAddError(null)
  }

  const handleAddCustomPhrase = async () => {
    if (createMutation.isPending) return
    const trimmed = newPhraseText.trim()
    if (trimmed.length < MIN_PHRASE_LENGTH) {
      setAddError(`Phrase must be at least ${MIN_PHRASE_LENGTH} characters.`)
      return
    }
    setAddError(null)
    try {
      const created = await createMutation.mutateAsync({
        phrase_text: trimmed,
        section,
        department_id: departmentId,
      })
      onSelectPhrase(created.phrase_text)
      setNewPhraseText('')
      setIsAdding(false)
    } catch (err: unknown) {
      setAddError(getErrorMessage(err, 'Could not save quick phrase. Please try again.'))
    }
  }

  const handleStartEdit = (phrase: QuickPhraseOut) => {
    setEditingId(phrase.id)
    setEditText(phrase.phrase_text)
    setEditError(null)
    setConfirmDeleteId(null)
    setDeleteError(null)
    setIsAdding(false)
    setAddError(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditText('')
    setEditError(null)
  }

  const handleSaveEdit = async (phraseId: number) => {
    if (updateMutation.isPending) return
    const trimmed = editText.trim()
    if (trimmed.length < MIN_PHRASE_LENGTH) {
      setEditError(`Phrase must be at least ${MIN_PHRASE_LENGTH} characters.`)
      return
    }
    setEditError(null)
    try {
      await updateMutation.mutateAsync({
        id: phraseId,
        body: { phrase_text: trimmed },
      })
      setEditingId(null)
      setEditText('')
    } catch (err: unknown) {
      setEditError(getErrorMessage(err, 'Could not update quick phrase. Please try again.'))
    }
  }

  const handleRequestDelete = (phraseId: number) => {
    setConfirmDeleteId(phraseId)
    setDeleteError(null)
    setEditingId(null)
    setEditError(null)
  }

  const handleConfirmDelete = async (phraseId: number) => {
    if (deleteMutation.isPending) return
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync(phraseId)
      setConfirmDeleteId(null)
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err, 'Could not delete quick phrase. Please try again.'))
    }
  }

  return (
    <div data-testid={`quick-phrase-bar-${section.toLowerCase()}`} className="mb-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <IconNotes size={14} className="text-slate-500" aria-hidden="true" />
          <span>Quick phrases — click to add</span>
        </span>

        <div className="flex items-center gap-2">
          {showSearch && (
            <div className="relative flex items-center">
              <IconSearch
                size={13}
                className="pointer-events-none absolute left-2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Filter quick phrases"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter phrases..."
                className="w-40 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-6 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear phrase filter"
                  className="absolute right-1.5 rounded p-0.5 text-slate-500 hover:text-slate-700"
                >
                  <IconX size={11} />
                </button>
              )}
            </div>
          )}

          {!readOnly && !isAdding && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
              title="Add a custom quick phrase for one-click re-use"
            >
              <IconPlus size={13} stroke={2.2} aria-hidden="true" />
              <span>Add Custom Phrase</span>
            </button>
          )}
        </div>
      </div>

      {!readOnly && isAdding && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="New quick phrase text"
              value={newPhraseText}
              maxLength={MAX_PHRASE_LENGTH}
              onChange={(e) => {
                setNewPhraseText(e.target.value)
                if (addError) setAddError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleAddCustomPhrase()
                } else if (e.key === 'Escape') {
                  handleCancelAdd()
                }
              }}
              placeholder="Type a phrase you use often (e.g. Lumbar spine spasm)..."
              className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
              autoFocus
            />
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => {
                void handleAddCustomPhrase()
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <IconCheck size={14} aria-hidden="true" />
              <span>{createMutation.isPending ? 'Saving...' : 'Save'}</span>
            </button>
            <button
              type="button"
              onClick={handleCancelAdd}
              className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              title="Cancel"
              aria-label="Cancel adding phrase"
            >
              <IconX size={14} />
            </button>
          </div>
          {addError && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {addError}
            </p>
          )}
        </div>
      )}

      {phrasesQuery.isPending && (
        <p role="status" className="text-xs text-slate-500">
          Loading quick phrases...
        </p>
      )}

      {phrasesQuery.isError && (
        <div
          role="alert"
          data-testid="quick-phrases-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <span className="inline-flex items-center gap-1.5">
            <IconAlertTriangle size={14} className="shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              {getErrorMessage(phrasesQuery.error, 'Could not load quick phrases.')}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              void phrasesQuery.refetch()
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <IconRefresh size={12} aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {!phrasesQuery.isPending && !phrasesQuery.isError && (
        <>
          {totalCount === 0 ? (
            <p className="text-xs text-slate-500">
              No saved quick phrases for this section yet.
            </p>
          ) : normalizedSearch && filteredDefaults.length === 0 && filteredPersonal.length === 0 ? (
            <p className="text-xs text-slate-500">
              No quick phrases match &ldquo;{searchQuery.trim()}&rdquo;.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredDefaults.length > 0 && (
                <div data-testid="quick-phrases-defaults" className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Hospital Defaults
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {filteredDefaults.map((phrase) => (
                      <button
                        key={phrase.id}
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          if (!readOnly) onSelectPhrase(phrase.phrase_text)
                        }}
                        className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-left text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-60"
                      >
                        + {phrase.phrase_text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredPersonal.length > 0 && (
                <div data-testid="quick-phrases-personal" className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8E1C3D]">
                    My Phrases
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {filteredPersonal.map((phrase) => {
                      const isEditingThis = editingId === phrase.id
                      const isConfirmingDelete = confirmDeleteId === phrase.id

                      if (isEditingThis && !readOnly) {
                        return (
                          <div
                            key={phrase.id}
                            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#8E1C3D]/40 bg-white px-2 py-1"
                          >
                            <input
                              type="text"
                              aria-label="Edit quick phrase text"
                              value={editText}
                              maxLength={MAX_PHRASE_LENGTH}
                              onChange={(e) => {
                                setEditText(e.target.value)
                                if (editError) setEditError(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void handleSaveEdit(phrase.id)
                                } else if (e.key === 'Escape') {
                                  handleCancelEdit()
                                }
                              }}
                              className="w-52 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-900 focus:border-[#8E1C3D] focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              disabled={updateMutation.isPending}
                              onClick={() => {
                                void handleSaveEdit(phrase.id)
                              }}
                              aria-label="Save edited phrase"
                              className="inline-flex cursor-pointer items-center gap-0.5 rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                            >
                              <IconCheck size={12} aria-hidden="true" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              aria-label="Cancel editing phrase"
                              className="cursor-pointer rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <IconX size={12} />
                            </button>
                          </div>
                        )
                      }

                      if (isConfirmingDelete && !readOnly) {
                        return (
                          <span
                            key={phrase.id}
                            data-testid={`confirm-delete-phrase-${phrase.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs text-red-900"
                          >
                            <span className="max-w-[180px] truncate font-medium">
                              Delete &ldquo;{phrase.phrase_text}&rdquo;?
                            </span>
                            <button
                              type="button"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                void handleConfirmDelete(phrase.id)
                              }}
                              aria-label={`Confirm delete quick phrase: ${phrase.phrase_text}`}
                              className="cursor-pointer rounded bg-red-700 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                            >
                              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null)
                                setDeleteError(null)
                              }}
                              aria-label="Cancel delete quick phrase"
                              className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-red-100"
                            >
                              Cancel
                            </button>
                          </span>
                        )
                      }

                      return (
                        <span
                          key={phrase.id}
                          className="inline-flex items-center rounded-full border border-[#8E1C3D]/25 bg-[#8E1C3D]/[0.05] text-xs text-slate-900"
                        >
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              if (!readOnly) onSelectPhrase(phrase.phrase_text)
                            }}
                            className="cursor-pointer rounded-l-full py-1 pl-3 pr-1.5 text-left transition-colors hover:text-[#8E1C3D] disabled:cursor-default disabled:opacity-60"
                          >
                            + {phrase.phrase_text}
                          </button>
                          {!readOnly && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(phrase)}
                                className="cursor-pointer rounded-full p-1 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900"
                                title="Edit quick phrase"
                                aria-label={`Edit quick phrase: ${phrase.phrase_text}`}
                              >
                                <PencilIcon />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRequestDelete(phrase.id)}
                                className="mr-1 cursor-pointer rounded-full p-1 text-slate-500 transition-colors hover:bg-white/80 hover:text-red-700"
                                title="Delete quick phrase"
                                aria-label={`Delete quick phrase: ${phrase.phrase_text}`}
                              >
                                <IconTrash size={11} stroke={2.2} />
                              </button>
                            </>
                          )}
                        </span>
                      )
                    })}
                  </div>
                  {editError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {editError}
                    </p>
                  )}
                  {deleteError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {deleteError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
