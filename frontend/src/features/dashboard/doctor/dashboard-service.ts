/**
 * Unified Doctor Dashboard Service
 *
 * Consolidates TanStack Query hooks, types, and operational helpers for the Doctor Workspace.
 * Conforms to offline LAN hospital invariants (central local DB, 0 CDN, resilient stale state).
 */

import {
  useDoctorDashboardSummary,
  useDoctorQueue,
  useAppointments,
  useUnfinishedEncounters,
  useTreatmentPlans,
} from '../../../api/queries'

import type {
  DoctorDashboardSummary,
  DoctorDashboardTodayGlance,
  DoctorQueueItem,
  DoctorQueueResponse,
  UnfinishedEncounter,
  TreatmentPlanOut,
  Appointment,
  AppointmentListResponse,
} from '../../../api/types'

export {
  useDoctorDashboardSummary,
  useDoctorQueue,
  useAppointments,
  useUnfinishedEncounters,
  useTreatmentPlans,
}

export type {
  DoctorDashboardSummary,
  DoctorDashboardTodayGlance,
  DoctorQueueItem,
  DoctorQueueResponse,
  UnfinishedEncounter,
  TreatmentPlanOut,
  Appointment,
  AppointmentListResponse,
}
