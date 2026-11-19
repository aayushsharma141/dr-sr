import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMe } from '../../../api/queries'
import {
  useDoctorDashboardSummary,
  useDoctorQueue,
  useAppointments,
  useUnfinishedEncounters,
  useTreatmentPlans,
} from './dashboard-service'

import { SummaryCards } from './components/SummaryCards'
import { LiveQueue } from './components/LiveQueue'
import { TodaysSchedule } from './components/TodaysSchedule'
import { UnfinishedConsultations } from './components/UnfinishedConsultations'
import { TodayGlance } from './components/TodayGlance'
import { RecentTreatmentPlans } from './components/RecentTreatmentPlans'
import { QuickActions } from './components/QuickActions'
import { NewConsultationModal } from './components/NewConsultationModal'

export function DoctorDashboard() {
  const navigate = useNavigate()
  const { data: me } = useMe()

  // Dynamic greeting based on current local time
  const getGreeting = () => {
    const hours = new Date().getHours()
    if (hours < 12) return 'Good Morning'
    if (hours < 17) return 'Good Afternoon'
    return 'Good Evening'
  }

  // Active queue tab state ('all' | 'waiting' | 'in_consultation' | 'scheduled')
  const [activeQueueTab, setActiveQueueTab] = useState<'all' | 'waiting' | 'in_consultation' | 'scheduled'>('all')

  // Modals state
  const [isNewConsultOpen, setIsNewConsultOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  // Data queries
  const {
    data: summary,
    isLoading: isLoadingSummary,
    refetch: refetchSummary,
  } = useDoctorDashboardSummary()

  const {
    data: queue,
    isLoading: isLoadingQueue,
    isRefetching: isRefetchingQueue,
    refetch: refetchQueue,
  } = useDoctorQueue()

  const { data: apptResponse, isLoading: isLoadingAppts } = useAppointments({
    doctor_id: me?.doctor_id ?? undefined,
  })
  const appointments = apptResponse?.appointments ?? []

  const { data: unfinishedEncounters, isLoading: isLoadingDrafts } = useUnfinishedEncounters()

  const { data: treatmentPlans = [], isLoading: isLoadingPlans } = useTreatmentPlans('ACTIVE')

  const handleRefreshAll = () => {
    refetchSummary()
    refetchQueue()
  }

  const doctorName = summary?.doctor_name_en || me?.full_name || 'Doctor'
  const specialty = summary?.specialty_name || 'Physiotherapy'

  return (
    <div className="space-y-5" data-testid="doctor-operational-dashboard">
      {/* 1. Header Bar: Greeting & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            {getGreeting()}, Dr. {doctorName} <span role="img" aria-label="wave">👋</span>
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-0.5">
            {specialty} • Doctor Workspace
          </p>
        </div>

        {/* Primary Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsNewConsultOpen(true)}
            data-testid="header-btn-new-consultation"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#800020] hover:bg-[#68001a] text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <span className="text-sm leading-none">+</span>
            New Consultation
          </button>

          <button
            type="button"
            onClick={() => navigate('/doctor/follow-ups')}
            data-testid="header-btn-add-followup"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-2xs transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Add Follow-up
          </button>

          <button
            type="button"
            onClick={() => navigate('/doctor/treatment-plans')}
            data-testid="header-btn-treatment-plan"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-2xs transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Treatment Plan
          </button>

          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            data-testid="header-btn-patient-search"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-2xs transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Patient Search
          </button>
        </div>
      </div>

      {/* 2. Row 1: 5 Summary Workload Cards */}
      <SummaryCards
        summary={summary}
        isLoading={isLoadingSummary}
        activeTab={activeQueueTab}
        onSelectTab={(tab) => setActiveQueueTab(tab)}
        onFocusSchedule={() => setActiveQueueTab('scheduled')}
        onFocusDrafts={() => {
          const el = document.getElementById('doctor-unfinished-consultations-section')
          el?.scrollIntoView({ behavior: 'smooth' })
        }}
      />

      {/* 3. Row 2: Live Queue (Left ~62%) and Schedule / Unfinished (Right ~38%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Live Queue */}
        <div className="lg:col-span-8 flex flex-col">
          <LiveQueue
            queue={queue}
            isLoading={isLoadingQueue}
            isRefetching={isRefetchingQueue}
            onRefresh={handleRefreshAll}
            activeTab={activeQueueTab}
            onSelectTab={(tab) => setActiveQueueTab(tab)}
          />
        </div>

        {/* Right Column: Today's Schedule & Unfinished Consultations */}
        <div className="lg:col-span-4 space-y-5">
          <TodaysSchedule
            appointments={appointments}
            isLoading={isLoadingAppts}
          />

          <div id="doctor-unfinished-consultations-section">
            <UnfinishedConsultations
              encounters={unfinishedEncounters}
              isLoading={isLoadingDrafts}
            />
          </div>
        </div>
      </div>

      {/* 4. Row 3: Today at a Glance, Recent Treatment Plans, Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1">
        <TodayGlance
          glance={summary?.today_glance}
          isLoading={isLoadingSummary}
        />

        <RecentTreatmentPlans
          plans={treatmentPlans}
          isLoading={isLoadingPlans}
        />

        <QuickActions
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenFollowUp={() => navigate('/doctor/follow-ups')}
          onOpenReports={() => navigate('/reception/reports')}
        />
      </div>

      {/* New Consultation Modal */}
      <NewConsultationModal
        isOpen={isNewConsultOpen || isSearchOpen}
        onClose={() => {
          setIsNewConsultOpen(false)
          setIsSearchOpen(false)
        }}
      />
    </div>
  )
}
