import { useState } from 'react'
import { Modal } from './Modal'
import { useDepartments, useDepartmentDoctors, usePatients, useBookAppointment } from '../api/queries'
import type { PatientOut, DepartmentDoctorOut } from '../api/types'
import { istToday } from '../format'

interface AppointmentBookingModalProps {
  isOpen: boolean
  onClose: () => void
  initialPatient?: PatientOut | null
  onSuccess?: () => void
}

export function AppointmentBookingModal({
  isOpen,
  onClose,
  initialPatient,
  onSuccess,
}: AppointmentBookingModalProps) {
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(
    initialPatient || null,
  )
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | ''>('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | ''>('')
  const [appointmentDate, setAppointmentDate] = useState(istToday)
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [allocatedToken, setAllocatedToken] = useState<number | null>(null)

  const { data: departments } = useDepartments()
  const { data: doctors } = useDepartmentDoctors(selectedDepartmentId || null)
  const { data: searchResults, isPending: isSearching } = usePatients(patientSearch, 5, 0)
  const bookMutation = useBookAppointment()

  if (!isOpen) return null

  const handleSelectPatient = (patient: PatientOut) => {
    setSelectedPatient(patient)
    setPatientSearch('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!selectedPatient) {
      setErrorMsg('Please select a patient.')
      return
    }
    if (!selectedDepartmentId) {
      setErrorMsg('Please select a department.')
      return
    }
    if (!selectedDoctorId) {
      setErrorMsg('Please select a doctor.')
      return
    }

    try {
      const res = await bookMutation.mutateAsync({
        patient_id: selectedPatient.id,
        department_id: Number(selectedDepartmentId),
        doctor_id: Number(selectedDoctorId),
        appointment_date: appointmentDate,
        notes: notes.trim() || null,
      })
      setAllocatedToken(res.token_number)
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('Failed to book appointment.')
      }
    }
  }

  const handleClose = () => {
    setAllocatedToken(null)
    setErrorMsg(null)
    onClose()
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title="Book New Appointment"
      busy={bookMutation.isPending}
      className="max-w-lg"
    >
      <div className="space-y-6">
        {allocatedToken !== null ? (
          <div className="space-y-4 text-center py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-800 mb-2">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h4 className="text-xl font-bold text-neutral-900">Appointment Confirmed!</h4>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs uppercase font-bold text-red-800 tracking-wider">
                Assigned Daily Token
              </p>
              <p className="text-4xl font-extrabold text-red-900 mt-1">
                Token #{allocatedToken}
              </p>
              <p className="text-sm text-neutral-700 mt-2">
                Patient: <span className="font-semibold">{selectedPatient?.full_name}</span> ({selectedPatient?.urn})
              </p>
              <p className="text-xs text-neutral-600">Date: {appointmentDate}</p>
            </div>
            <button
              onClick={handleClose}
              className="w-full py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div role="alert" className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                {errorMsg}
              </div>
            )}

            {/* Patient Selector */}
            <div>
              <label htmlFor="patient-search" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Patient
              </label>
              {selectedPatient ? (
                <div className="flex justify-between items-center p-3 bg-neutral-50 rounded border border-neutral-300">
                  <div>
                    <span className="font-bold text-neutral-900">{selectedPatient.full_name}</span>
                    <span className="ml-2 font-mono text-xs text-red-800">({selectedPatient.urn})</span>
                    <p className="text-xs text-neutral-500">Mobile: {selectedPatient.mobile} | Age: {selectedPatient.age_years}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPatient(null)}
                    className="text-xs text-red-700 hover:underline font-medium"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    id="patient-search"
                    data-autofocus
                    type="text"
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search patient by URN, mobile or name..."
                    className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                  />
                  {isSearching && <p className="text-xs text-neutral-500">Searching patients...</p>}
                  {searchResults && searchResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto border border-neutral-200 rounded divide-y divide-neutral-100 bg-white">
                      {searchResults.slice(0, 5).map((p: PatientOut) => (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => handleSelectPatient(p)}
                          className="w-full p-2 text-left text-sm hover:bg-neutral-50 cursor-pointer flex justify-between items-center"
                        >
                          <div>
                            <span className="font-semibold text-neutral-900">{p.full_name}</span>
                            <span className="text-xs text-neutral-500 ml-2">({p.urn})</span>
                          </div>
                          <span className="text-xs font-mono text-neutral-600">{p.mobile}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Department first, then its assigned doctors */}
            <div>
              <label htmlFor="department-select" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Department / Specialty
              </label>
              <select
                id="department-select"
                value={selectedDepartmentId}
                onChange={(e) => {
                  setSelectedDepartmentId(e.target.value ? Number(e.target.value) : '')
                  setSelectedDoctorId('')
                }}
                required
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              >
                <option value="">-- Select Department --</option>
                {departments?.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name_en}{department.name_hi ? ` / ${department.name_hi}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="doctor-select" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Consulting Doctor
              </label>
              <select
                id="doctor-select"
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!selectedDepartmentId}
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800 disabled:bg-neutral-100"
              >
                <option value="">-- Select Doctor --</option>
                {doctors?.map((d: DepartmentDoctorOut) => (
                  <option key={d.id} value={d.id}>
                    {d.name_en} {d.name_hi ? `(${d.name_hi})` : ''} - {d.qualification || 'Clinician'}
                  </option>
                ))}
              </select>
              {selectedDepartmentId && doctors?.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">No active doctors are assigned to this department.</p>
              )}
            </div>

            {/* Date Selector */}
            <div>
              <label htmlFor="date-input" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Appointment Date
              </label>
              <input
                id="date-input"
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                required
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              />
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="notes-input" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Notes (Optional)
              </label>
              <textarea
                id="notes-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Chief symptom / remarks..."
                rows={2}
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-neutral-300 rounded text-sm font-medium hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookMutation.isPending || !selectedPatient || !selectedDoctorId}
                className="px-4 py-2 bg-red-900 text-white rounded text-sm font-medium hover:bg-red-800 disabled:opacity-50"
              >
                {bookMutation.isPending ? 'Booking...' : 'Confirm & Allocate Token'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
