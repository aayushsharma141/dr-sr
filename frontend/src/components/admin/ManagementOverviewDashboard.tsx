import { useState, useId } from 'react'
import { Link } from 'react-router'
import { useManagementOverview } from '../../api/queries'
import type { AdminOverview } from '../../api/types'

interface ManagementOverviewDashboardProps {
  overview?: Partial<AdminOverview>
}

function formatPaiseToRupees(paise: number): string {
  const rupees = Math.round(paise / 100)
  return `₹${rupees.toLocaleString('en-IN')}`
}

function formatPaiseToLakhs(paise: number): string {
  const lakhs = (paise / (100 * 100000)).toFixed(2)
  return `₹${lakhs} L`
}

export function ManagementOverviewDashboard({ overview }: ManagementOverviewDashboardProps) {
  const { data: mgmt } = useManagementOverview()
  const [selectedMonth, setSelectedMonth] = useState('Nov 2026')
  const [comparisonMonth, setComparisonMonth] = useState('Oct 2026')
  const filterId = useId()

  // Baseline data matching mockup if network data is pending or empty
  const revValue = mgmt?.monthly_revenue?.value_paise ?? 84200000
  const revPrior = mgmt?.monthly_revenue?.prior_paise ?? 74900000
  const revPct = mgmt?.monthly_revenue?.percent_change ?? 12.4

  const expValue = mgmt?.operating_expenses?.value_paise ?? 31600000
  const expPrior = mgmt?.operating_expenses?.prior_paise ?? 30100000
  const expPct = mgmt?.operating_expenses?.percent_change ?? 5.1

  const surplusValue = mgmt?.net_surplus?.value_paise ?? 52600000
  const surplusPrior = mgmt?.net_surplus?.prior_paise ?? 44800000
  const surplusPct = mgmt?.net_surplus?.percent_change ?? 17.6

  const receivables = mgmt?.outstanding_receivables_paise ?? overview?.outstanding_dues_paise ?? 4260000

  const departmentData = mgmt?.department_revenues ?? [
    { name: 'Orthopaedics', percentage: 45, revenue_paise: 37890000, color: '#8E1C3D' },
    { name: 'Physiotherapy', percentage: 20, revenue_paise: 16840000, color: '#38bdf8' },
    { name: 'General Consultation', percentage: 15, revenue_paise: 12630000, color: '#10b981' },
    { name: 'Follow-up & Reviews', percentage: 12, revenue_paise: 10104000, color: '#f59e0b' },
    { name: 'Other Services', percentage: 8, revenue_paise: 6736000, color: '#94a3b8' },
  ]

  const attentionItems = mgmt?.management_attention ?? [
    { key: 'sec', label: 'Unreviewed security events', count: 3, badge_variant: 'danger', target_path: '/admin/security' },
    { key: 'audit', label: 'Pending audit reviews', count: 6, badge_variant: 'warning', target_path: '/admin/audit' },
    { key: 'adj', label: 'Unapproved financial adjustments', count: 2, badge_variant: 'warning', target_path: '/admin/billing' },
    { key: 'users', label: 'Inactive user accounts', count: 4, badge_variant: 'neutral', target_path: '/admin/users' },
    { key: 'backup', label: 'Backup verification due', count: 1, badge_variant: 'neutral', target_path: '/admin/backups' },
  ]
  const attentionTotal = mgmt?.management_attention_total ?? 6

  const handleExport = () => {
    window.print()
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Controls Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Management Overview
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Hospital performance, governance and system health at a glance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative inline-flex items-center">
            <span className="pointer-events-none absolute left-3 text-slate-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
                <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
                <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
                <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" />
              </svg>
            </span>
            <select
              id={`${filterId}-month`}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9.5 appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-semibold text-slate-700 shadow-2xs hover:border-slate-300 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
              aria-label="Reporting month"
            >
              <option value="Nov 2026">Nov 2026</option>
              <option value="Oct 2026">Oct 2026</option>
              <option value="Sep 2026">Sep 2026</option>
            </select>
            <span className="pointer-events-none absolute right-2.5 text-slate-500">▾</span>
          </div>

          <div className="relative inline-flex items-center">
            <select
              id={`${filterId}-compare`}
              value={comparisonMonth}
              onChange={(e) => setComparisonMonth(e.target.value)}
              className="h-9.5 appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-8 text-xs font-semibold text-slate-700 shadow-2xs hover:border-slate-300 focus:border-[#8E1C3D] focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
              aria-label="Comparison period"
            >
              <option value="Oct 2026">vs. Oct 2026</option>
              <option value="Sep 2026">vs. Sep 2026</option>
              <option value="Aug 2026">vs. Aug 2026</option>
            </select>
            <span className="pointer-events-none absolute right-2.5 text-slate-500">▾</span>
          </div>

          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-[#741732] px-4 text-xs font-bold text-white shadow-2xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Report
          </button>
        </div>
      </div>

      {/* KPI Cards Row (4 cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Monthly Revenue */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
              <span className="text-xl font-bold">₹</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Monthly Revenue</p>
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {formatPaiseToRupees(revValue)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="inline-flex items-center font-bold text-emerald-700">
              ↑ +{revPct}%
            </span>
            <span className="text-slate-500">
              vs. {formatPaiseToRupees(revPrior)} (Oct)
            </span>
          </div>
        </div>

        {/* Operating Expenses */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500 border border-rose-100">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Operating Expenses</p>
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {formatPaiseToRupees(expValue)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="inline-flex items-center font-bold text-rose-600">
              ↑ +{expPct}%
            </span>
            <span className="text-slate-500">
              vs. {formatPaiseToRupees(expPrior)} (Oct)
            </span>
          </div>
        </div>

        {/* Net Operating Surplus */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 border border-sky-100">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <line x1="18" y1="20" x2="18" y2="10" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="20" x2="12" y2="4" strokeWidth="2" strokeLinecap="round" />
                <line x1="6" y1="20" x2="6" y2="14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Net Operating Surplus</p>
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {formatPaiseToRupees(surplusValue)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="inline-flex items-center font-bold text-emerald-700">
              ↑ +{surplusPct}%
            </span>
            <span className="text-slate-500">
              vs. {formatPaiseToRupees(surplusPrior)} (Oct)
            </span>
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 border border-amber-100">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">Outstanding Receivables</p>
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {formatPaiseToRupees(receivables)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <Link
              to="/reception/dues"
              className="font-bold text-[#8E1C3D] hover:text-[#5D0B26] hover:underline"
            >
              View Ageing &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Middle Strip: Financial Performance Trend (line/area), Revenue by Department (donut), Management Attention */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Financial Performance Trend Chart */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <svg className="h-5 w-5 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="text-sm font-bold text-slate-900">Financial Performance Trend</h2>
          </div>

          <div className="mt-4">
            <div className="relative h-56 w-full">
              <svg className="h-full w-full overflow-visible" viewBox="0 0 400 200" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8E1C3D" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#8E1C3D" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Y-axis gridlines & labels */}
                {[
                  { y: 20, label: '₹1,000k' },
                  { y: 60, label: '₹800k' },
                  { y: 100, label: '₹600k' },
                  { y: 140, label: '₹400k' },
                  { y: 170, label: '₹200k' },
                  { y: 195, label: '₹0' },
                ].map((item, i) => (
                  <g key={i}>
                    <line x1="50" y1={item.y} x2="390" y2={item.y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3" />
                    <text x="45" y={item.y + 3} textAnchor="end" className="text-xs fill-slate-500 font-medium">
                      {item.label}
                    </text>
                  </g>
                ))}

                {/* Revenue area & curve */}
                {/* Coordinates: Jun: 60,110 | Jul: 120,85 | Aug: 180,90 | Sep: 240,75 | Oct: 300,80 | Nov: 360,55 */}
                <path
                  d="M 60 110 L 120 85 L 180 90 L 240 75 L 300 80 L 360 55 L 360 195 L 60 195 Z"
                  fill="url(#revenueGradient)"
                />
                <path
                  d="M 60 110 L 120 85 L 180 90 L 240 75 L 300 80 L 360 55"
                  fill="none"
                  stroke="#8E1C3D"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Expenses line */}
                {/* Coordinates: Jun: 60,165 | Jul: 120,160 | Aug: 180,162 | Sep: 240,155 | Oct: 300,152 | Nov: 360,148 */}
                <path
                  d="M 60 165 L 120 160 L 180 162 L 240 155 L 300 152 L 360 148"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Data points */}
                {[
                  { cx: 60, cy: 110 }, { cx: 120, cy: 85 }, { cx: 180, cy: 90 },
                  { cx: 240, cy: 75 }, { cx: 300, cy: 80 }, { cx: 360, cy: 55 },
                ].map((pt, i) => (
                  <circle key={`r-${i}`} cx={pt.cx} cy={pt.cy} r="3.5" fill="#ffffff" stroke="#8E1C3D" strokeWidth="2" />
                ))}

                {[
                  { cx: 60, cy: 165 }, { cx: 120, cy: 160 }, { cx: 180, cy: 162 },
                  { cx: 240, cy: 155 }, { cx: 300, cy: 152 }, { cx: 360, cy: 148 },
                ].map((pt, i) => (
                  <circle key={`e-${i}`} cx={pt.cx} cy={pt.cy} r="3.5" fill="#ffffff" stroke="#10b981" strokeWidth="2" />
                ))}

                {/* X-axis labels */}
                {['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((month, idx) => (
                  <text key={month} x={60 + idx * 60} y="208" textAnchor="middle" className="text-xs fill-slate-500 font-medium">
                    {month}
                  </text>
                ))}
              </svg>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-6 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                <span className="h-2.5 w-2.5 rounded-full bg-[#8E1C3D]" />
                Revenue
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Expenses
              </span>
            </div>
          </div>
        </div>

        {/* Revenue by Department Donut Chart */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs lg:col-span-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <svg className="h-5 w-5 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
            <h2 className="text-sm font-bold text-slate-900">Revenue by Department</h2>
          </div>

          <div className="mt-4 flex flex-col items-center sm:flex-row sm:justify-between gap-4">
            {/* Donut SVG */}
            <div className="relative flex h-44 w-44 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
                {/* 5 Slices circumference = 2 * PI * 36 ≈ 226.2 */}
                {/* Slice 1: Orthopaedics 45% = 101.8 */}
                <circle
                  cx="50"
                  cy="50"
                  r="36"
                  fill="transparent"
                  stroke="#8E1C3D"
                  strokeWidth="16"
                  strokeDasharray="101.8 124.4"
                  strokeDashoffset="0"
                />
                {/* Slice 2: Physiotherapy 20% = 45.2 */}
                <circle
                  cx="50"
                  cy="50"
                  r="36"
                  fill="transparent"
                  stroke="#38bdf8"
                  strokeWidth="16"
                  strokeDasharray="45.2 181.0"
                  strokeDashoffset="-101.8"
                />
                {/* Slice 3: General Consultation 15% = 33.9 */}
                <circle
                  cx="50"
                  cy="50"
                  r="36"
                  fill="transparent"
                  stroke="#10b981"
                  strokeWidth="16"
                  strokeDasharray="33.9 192.3"
                  strokeDashoffset="-147.0"
                />
                {/* Slice 4: Follow-up & Reviews 12% = 27.1 */}
                <circle
                  cx="50"
                  cy="50"
                  r="36"
                  fill="transparent"
                  stroke="#f59e0b"
                  strokeWidth="16"
                  strokeDasharray="27.1 199.1"
                  strokeDashoffset="-180.9"
                />
                {/* Slice 5: Other Services 8% = 18.2 */}
                <circle
                  cx="50"
                  cy="50"
                  r="36"
                  fill="transparent"
                  stroke="#94a3b8"
                  strokeWidth="16"
                  strokeDasharray="18.2 208.0"
                  strokeDashoffset="-208.0"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-sm font-extrabold text-slate-900">
                  {formatPaiseToLakhs(revValue)}
                </span>
                <span className="text-xs font-medium text-slate-500">Total</span>
              </div>
            </div>

            {/* Legend breakdown list */}
            <ul className="flex-1 space-y-2 text-xs">
              {departmentData.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-xs"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="truncate text-slate-700 font-medium">{d.name}</span>
                  </div>
                  <span className="font-bold text-slate-900 shrink-0">{d.percentage}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Management Attention Panel */}
        <div className="rounded-xl border border-rose-100 bg-white p-5 shadow-2xs lg:col-span-3">
          <div className="flex items-center justify-between border-b border-rose-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-rose-600 font-bold">⚠</span>
              <h2 className="text-sm font-bold text-slate-900">Management Attention</h2>
            </div>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
              {attentionTotal}
            </span>
          </div>

          <ul className="mt-3 divide-y divide-slate-100">
            {attentionItems.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.target_path}
                  className="flex items-center justify-between py-2.5 text-xs text-slate-700 hover:text-[#8E1C3D] transition-colors group"
                >
                  <span className="truncate pr-2 font-medium group-hover:font-semibold">
                    {item.label}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex min-w-5 items-center justify-center rounded px-1.5 py-0.5 text-xs font-bold ${
                        item.badge_variant === 'danger'
                          ? 'bg-rose-100 text-rose-700'
                          : item.badge_variant === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {item.count}
                    </span>
                    <span className="text-slate-500 group-hover:text-[#8E1C3D]">&rsaquo;</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Lower Strip: Hospital Growth, Doctor Utilization, Patient Growth Trend, System Health */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Hospital Growth */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-2 text-slate-700">
            <svg className="h-4 w-4 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <h3 className="text-xs font-bold text-slate-900">Hospital Growth</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">New Patients</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900 tracking-tight">228</p>
              <span className="mt-1 inline-flex items-center text-xs font-bold text-emerald-700">
                ↑ +14.6%
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Returning Patients</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900 tracking-tight">1,034</p>
              <span className="mt-1 inline-flex items-center text-xs font-bold text-emerald-700">
                ↑ +8.9%
              </span>
            </div>
          </div>
        </div>

        {/* Doctor Utilization */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-2 text-slate-700">
            <svg className="h-4 w-4 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h3 className="text-xs font-bold text-slate-900">Doctor Utilization</h3>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">76%</p>
            <p className="text-xs font-medium text-slate-500">Consultation time utilized</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#8E1C3D]"
                style={{ width: '76%' }}
              />
            </div>
          </div>
        </div>

        {/* Patient Growth Trend Bar Chart */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-700">
              <svg className="h-4 w-4 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <h3 className="text-xs font-bold text-slate-900">Patient Growth Trend</h3>
            </div>
            <span className="text-xs font-bold text-emerald-700">↑ +11.2%</span>
          </div>
          <div className="mt-4 flex h-20 items-end justify-between gap-2 pt-2">
            {[
              { month: 'Jun', height: '35%' },
              { month: 'Jul', height: '50%' },
              { month: 'Aug', height: '62%' },
              { month: 'Sep', height: '75%' },
              { month: 'Oct', height: '88%' },
              { month: 'Nov', height: '100%' },
            ].map((bar) => (
              <div key={bar.month} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                <div
                  className="w-full rounded-t-xs bg-rose-200/90 hover:bg-[#8E1C3D] transition-colors"
                  style={{ height: bar.height }}
                />
                <span className="text-xs text-slate-500 font-medium">{bar.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* System Health Status */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" strokeWidth="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" strokeWidth="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="2" strokeLinecap="round" />
                <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <h3 className="text-xs font-bold text-slate-900">System Health</h3>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Healthy
            </span>
          </div>

          <ul className="mt-3 space-y-2 text-xs">
            <li className="flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-700 font-bold">✔</span>
                Application
              </span>
              <span className="font-semibold text-slate-900">v1.16.0</span>
            </li>
            <li className="flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-700 font-bold">✔</span>
                Database
              </span>
              <span className="font-semibold text-slate-900">Healthy</span>
            </li>
            <li className="flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-700 font-bold">✔</span>
                Backup (Last run)
              </span>
              <span className="font-semibold text-slate-900">Nov 5, 02:00</span>
            </li>
            <li className="flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-700 font-bold">✔</span>
                Storage Usage
              </span>
              <span className="font-semibold text-slate-900">62% (186 GB / 300 GB)</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Strip: Quick Access Grid (6 tiles) */}
      <section aria-label="Quick Access" className="rounded-xl border border-slate-100 bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <svg className="h-4 w-4 text-[#8E1C3D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <rect x="3" y="3" width="7" height="7" strokeWidth="2" />
            <rect x="14" y="3" width="7" height="7" strokeWidth="2" />
            <rect x="14" y="14" width="7" height="7" strokeWidth="2" />
            <rect x="3" y="14" width="7" height="7" strokeWidth="2" />
          </svg>
          <h2 className="text-sm font-bold text-slate-900">Quick Access</h2>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Link
            to="/admin/billing"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Financial Reports
            </span>
          </Link>

          <Link
            to="/admin/audit"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Audit & Compliance
            </span>
          </Link>

          <Link
            to="/admin/users"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Users & Roles
            </span>
          </Link>

          <Link
            to="/admin/backups"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zm0 5h16" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Backup & Restore
            </span>
          </Link>

          <Link
            to="/admin/settings"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Configuration
            </span>
          </Link>

          <Link
            to="/admin/settings"
            className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 text-center shadow-2xs hover:border-[#8E1C3D]/40 hover:bg-rose-50/30 hover:shadow-xs transition-all group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D] group-hover:scale-110 transition-transform">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="mt-2 text-xs font-bold text-slate-800 group-hover:text-[#8E1C3D]">
              Hospital Profile
            </span>
          </Link>
        </div>
      </section>

      {/* System User Counts for administration & accessibility */}
      {overview?.user_counts && (
        <section aria-label="System User Counts" className="sr-only">
          <h3>System User Counts</h3>
          <ul>
            {Object.entries(overview.user_counts).map(([r, c]) => (
              <li key={r}>
                {r}: {c.active} active, {c.inactive} inactive
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
