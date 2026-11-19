import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { IconRupee, IconReceipt, IconReportMedical, IconClock } from '../icons'

export type ReceptionFinancialTab = 'billing' | 'dues' | 'receipts' | 'reports' | 'ledger'

interface ReceptionDeskTabsProps {
  activeTab: ReceptionFinancialTab
  actions?: ReactNode
  isAdmin?: boolean
}

/**
 * Shared top navigation tabs for Reception's financial counter:
 * 1. Billing & Checkout (/reception/billing)
 * 2. Pending Dues (/reception/billing?tab=dues)
 * 3. Receipts Desk (/reception/receipts)
 * 4. Daily Collection Report (/reception/reports)
 */
export function ReceptionDeskTabs({ activeTab, actions, isAdmin }: ReceptionDeskTabsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 bg-white px-3 pt-2 sm:pt-0 sm:py-1 rounded-xl shadow-2xs print:hidden mb-2">
      <nav
        aria-label="Reception Desk Financial Tabs"
        className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0"
      >
        {!isAdmin ? (
          <Link
            to="/reception/billing"
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${activeTab === 'billing'
              ? 'border-brand-700 text-brand-800 bg-brand-50/70'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            <IconRupee className="h-4 w-4 text-brand-700" />
            Billing &amp; Checkout
          </Link>
        ) : (
          <Link
            to="/reception/billing?tab=ledger"
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${activeTab === 'ledger' || activeTab === 'billing'
              ? 'border-brand-700 text-brand-800 bg-brand-50/70'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            <IconReceipt className="h-4 w-4 text-brand-700" />
            Receipts Ledger
          </Link>
        )}

        <Link
          to="/reception/billing?tab=dues"
          className={`flex shrink-0 items-center gap-2 border-b-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${activeTab === 'dues'
            ? 'border-brand-700 text-brand-800 bg-brand-50/70'
            : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
        >
          <IconClock className="h-4 w-4 text-brand-700" />
          Pending Dues
        </Link>

        <Link
          to="/reception/receipts"
          className={`flex shrink-0 items-center gap-2 border-b-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${activeTab === 'receipts'
            ? 'border-brand-700 text-brand-800 bg-brand-50/70'
            : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
        >
          <IconReceipt className="h-4 w-4 text-brand-700" />
          Receipts Desk
        </Link>

        {!isAdmin && (
          <Link
            to="/reception/reports"
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${activeTab === 'reports'
              ? 'border-brand-700 text-brand-800 bg-brand-50/70'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
          >
            <IconReportMedical className="h-4 w-4 text-brand-700" />
            Daily Collection Report
          </Link>
        )}
      </nav>

      {actions && (
        <div className="flex items-center gap-2 pb-2 sm:pb-0 shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
