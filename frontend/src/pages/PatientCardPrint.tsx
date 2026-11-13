import { useParams, useNavigate } from 'react-router'
import { usePatient, useClinicSettings } from '../api/queries'
import { RegistrationCard } from '../components/RegistrationCard'

export function PatientCardPrint() {
  const { id } = useParams<{ id: string }>()
  const patientId = Number(id)
  const navigate = useNavigate()

  const { data: patient, isPending: patientPending, isError: patientError } = usePatient(
    isNaN(patientId) ? null : patientId,
  )
  const { data: settings } = useClinicSettings()

  if (patientPending) {
    return (
      <div role="status" className="min-h-screen flex items-center justify-center bg-white p-6">
        <p className="text-neutral-600 font-medium">Loading patient card...</p>
      </div>
    )
  }

  if (patientError || !patient) {
    return (
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center bg-white p-6 space-y-4">
        <p className="text-red-800 font-medium">Failed to load patient card.</p>
        <button
          type="button"
          onClick={() => navigate('/reception/patients')}
          className="min-h-11 rounded text-sm font-medium text-red-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-900"
        >
          &larr; Back to Patient Directory
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white p-4 sm:p-8">
      <RegistrationCard
        patient={patient}
        settings={settings}
        onBack={() => navigate(`/reception/patients/${patient.id}`)}
      />
    </div>
  )
}
