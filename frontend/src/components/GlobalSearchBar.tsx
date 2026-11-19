import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { apiFetch } from '../api/client'
import type { PatientOut } from '../api/types'
import { IconSearch } from './icons'

export function GlobalSearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientOut[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Global keyboard shortcut '/' to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeEl = document.activeElement
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        activeEl?.getAttribute('contenteditable') === 'true'

      if (e.key === '/' && !isInput) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (e.key === 'Escape') {
        setIsOpen(false)
        inputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounced search querying /patients?q=...
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setIsLoading(false)
      setSearchError(null)
      return
    }

    setIsLoading(true)
    setSearchError(null)

    // Once the query changes, this search is stale: a reply that arrives late must not replace
    // the results for the newer query (staff could open the wrong patient).
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<PatientOut[]>(
          `/patients?q=${encodeURIComponent(trimmed)}&limit=8`
        )
        if (stale) return
        setResults(data || [])
        setIsOpen(true)
      } catch (err: unknown) {
        if (stale) return
        setSearchError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      } finally {
        if (!stale) setIsLoading(false)
      }
    }, 220)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  const handleSelectPatient = (patientId: number) => {
    setIsOpen(false)
    setQuery('')
    navigate(`/reception/patients/${patientId}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md lg:max-w-lg">
      <div className="relative flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-slate-50 transition-colors hover:bg-white focus-within:border-brand-700 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-700/20">
        <span className="pointer-events-none absolute left-3 flex items-center text-slate-500" aria-hidden="true">
          <IconSearch className="h-4 w-4 shrink-0" />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.trim().length >= 2) setIsOpen(true)
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setIsOpen(true)
          }}
          placeholder="Search URN, name or mobile... [/]"
          aria-label="Search patients by URN, name or mobile"
          className="min-h-[38px] w-full rounded-lg bg-transparent py-2 pl-9 pr-12 text-xs sm:text-sm leading-snug text-slate-900 placeholder:text-slate-500 focus:outline-none"
        />
        <div className="absolute right-2.5 flex items-center gap-1">
          {isLoading ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700"
              aria-hidden="true"
            />
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setResults([])
                setIsOpen(false)
                inputRef.current?.focus()
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs leading-none text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-slate-200 bg-white px-1.5 text-xs font-mono font-medium leading-none text-slate-600 shadow-2xs">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {isLoading && results.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-600">Searching records…</div>
          ) : searchError ? (
            <div className="py-3 px-3 text-xs font-medium text-red-700">{searchError}</div>
          ) : results.length === 0 ? (
            <div className="py-4 px-3 text-center text-xs text-slate-600">
              No patients found matching &ldquo;<span className="font-semibold text-slate-900">{query}</span>&rdquo;
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              <div className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider tabular-nums text-slate-600">
                Patients ({results.length})
              </div>
              {results.map((patient) => {
                const initials = patient.full_name
                  ? patient.full_name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0].toUpperCase())
                      .join('')
                  : 'PT'

                return (
                  <div
                    key={patient.id}
                    onClick={() => handleSelectPatient(patient.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelectPatient(patient.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 hover:bg-brand-50/60 transition-colors focus-visible:outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-700/30"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 border border-brand-200 text-xs font-bold tracking-tight text-brand-800">
                        {initials}
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-xs sm:text-sm font-semibold leading-snug tracking-tight text-slate-900 group-hover:text-brand-800">
                            {patient.full_name}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono font-medium tabular-nums text-slate-700">
                            {patient.urn}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs leading-snug tabular-nums text-slate-600">
                          {patient.age_years != null && <span className="shrink-0">{patient.age_years} yrs</span>}
                          {patient.gender && <span className="shrink-0">• {patient.gender}</span>}
                          {patient.mobile && <span className="truncate">• {patient.mobile}</span>}
                        </div>
                        {patient.allergies && patient.allergies !== 'None reported' && (
                          <div className="mt-0.5 truncate text-xs font-bold leading-snug text-red-700">
                            Allergies: {patient.allergies}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* No "Consult" shortcut here: a consultation starts from the doctor's queue, so it
                        always belongs to a checked-in appointment and its visit. */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className="text-sm leading-none text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700"
                        aria-hidden="true"
                      >
                        →
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
