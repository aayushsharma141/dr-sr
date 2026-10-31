import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useLogout } from '../api/queries'
import type { Role } from '../api/types'

interface AppShellProps {
  name: string
  role: Role
  children: ReactNode
}

export function AppShell({ name, role, children }: AppShellProps) {
  const navigate = useNavigate()
  const logout = useLogout()

  const handleSignOut = async () => {
    try {
      await logout.mutateAsync()
    } finally {
      navigate('/login')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col text-neutral-900">
      <header className="bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-red-900 tracking-tight">
            Kalyan Hospital
          </h1>
          <p className="text-xs text-neutral-500">Patient & Physiotherapy LAN Platform</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium text-neutral-900">{name}</p>
            <p className="text-xs text-neutral-500 font-mono tracking-wide">{role}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={logout.isPending}
            className="px-3 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>
    </div>
  )
}
