import { DoctorDashboardUnfinishedCard } from '../../../../components/DoctorDashboardUnfinishedCard'
import type { UnfinishedEncounter } from '../dashboard-service'

interface UnfinishedConsultationsProps {
  encounters?: UnfinishedEncounter[]
  isLoading?: boolean
  onNavigate?: (id: number) => void
}

export function UnfinishedConsultations({
  encounters,
  isLoading,
  onNavigate,
}: UnfinishedConsultationsProps) {
  return (
    <div data-testid="unfinished-consultations-wrapper">
      <DoctorDashboardUnfinishedCard
        encounters={encounters}
        isLoading={isLoading}
        onNavigate={onNavigate}
      />
    </div>
  )
}
