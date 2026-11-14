import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { apiFetch } from '../api/client'
import type { PatientOut, Role } from '../api/types'
import { IconSearch } from './icons'

interface GlobalSearchBarProps {
  role?: Role
}

export function GlobalSearchBar({ role }: GlobalSearchBarProps) {
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

    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<PatientOut[]>(
          `/patients?q=${encodeURIComponent(trimmed)}&limit=8`
        )
        setResults(data || [])
        setIsOpen(true)
      } catch (err: unknown) {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 220)

    return () => clearTimeout(timer)
  }, [query])

  const handleSelectPatient = (patientId: number) => {
    setIsOpen(false)
    setQuery('')
    navigate(`/reception/patients/${patientId}`)
  }

  const handleStartConsult = (patientId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    setQuery('')
    navigate(`/doctor/encounters/new?patient_id=${patientId}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md lg:max-w-lg">
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-slate-500" aria-hidden="true">
          <IconSearch className="h-4 w-4" />
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
          className="w-full rounded-lg border border-slate-300 bg-slate-50/80 py-1.5 pl-9 pr-14 text-xs sm:text-sm text-slate-900 placeholder:text-slate-500 transition-colors hover:bg-white focus:border-[#8E1C3D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
        />
        <div className="absolute right-2.5 flex items-center gap-1">
          {isLoading ? (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-[#8E1C3D]"
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
              className="rounded p-0.5 text-slate-500 hover:text-slate-600 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#8E1C3D]"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : (
            <kbd className="hidden sm:inline-block rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-mono font-medium text-slate-500 shadow-2xs">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          {isLoading && results.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-500">Searching records…</div>
          ) : searchError ? (
            <div className="py-3 px-3 text-xs text-red-600">{searchError}</div>
          ) : results.length === 0 ? (
            <div className="py-4 px-3 text-center text-xs text-slate-500">
              No patients found matching &ldquo;<span className="font-semibold">{query}</span>&rdquo;
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              <div className="px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-500">
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
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#8E1C3D]/10 text-xs font-bold text-[#8E1C3D]">
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs sm:text-sm font-semibold text-slate-900 group-hover:text-[#8E1C3D]">
                            {patient.full_name}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.2 text-xs font-mono font-medium text-slate-700">
                            {patient.urn}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {patient.age_years != null && <span>{patient.age_years} yrs</span>}
                          {patient.gender && <span>• {patient.gender}</span>}
                          {patient.mobile && <span>• 📞 {patient.mobile}</span>}
                        </div>
                        {patient.allergies && patient.allergies !== 'None reported' && (
                          <div className="mt-0.5 text-xs font-bold text-red-600">
                            ⚠️ Allergies: {patient.allergies}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {role === 'DOCTOR' && (
                        <button
                          type="button"
                          onClick={(e) => handleStartConsult(patient.id, e)}
                          title="Start Clinical Consultation"
                          className="rounded bg-[#8E1C3D] px-2 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-[#721530]"
                        >
                          Consult
                        </button>
                      )}
                      <span className="text-slate-500 group-hover:text-slate-700">→</span>
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
