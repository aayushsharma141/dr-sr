import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { ClinicSettingsOut } from './types'

const FALLBACK = {
  trustNameEn: 'Sri Vashishtha Kalyan Trust',
  trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
  hospitalName: 'Kalyan Hospital',
  address: 'स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, भोजपुर, बिहार - 802301',
  locationLine: 'Ara, Bhojpur, Bihar',
}

/** Application header identity from clinic settings, shown even while settings are unavailable. */
export function useClinicBranding() {
  const { data } = useQuery({
    queryKey: ['clinic-settings'],
    queryFn: () => apiFetch<ClinicSettingsOut>('/settings'),
  })
  return {
    trustNameEn: data?.trust_name_en || FALLBACK.trustNameEn,
    trustNameHi: data?.trust_name_hi || FALLBACK.trustNameHi,
    hospitalName: data?.name_en || FALLBACK.hospitalName,
    address: data?.address_1 || FALLBACK.address,
    locationLine: data?.location_line || FALLBACK.locationLine,
  }
}
