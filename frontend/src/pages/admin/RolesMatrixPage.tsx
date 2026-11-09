import { Fragment, useMemo } from 'react'
import { useMe, useRolePermissions } from '../../api/queries'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'
import type { PermissionInfo, RolePermissionsOut } from '../../api/types'

interface PermissionGroup {
  name: string
  permissions: PermissionInfo[]
}

/** Groups permissions in the order the API returns them (first appearance of each group). */
function groupPermissions(data: RolePermissionsOut): PermissionGroup[] {
  const groups: PermissionGroup[] = []
  const byName = new Map<string, PermissionGroup>()
  for (const p of data.permissions) {
    let g = byName.get(p.group)
    if (!g) {
      g = { name: p.group, permissions: [] }
      byName.set(p.group, g)
      groups.push(g)
    }
    g.permissions.push(p)
  }
  return groups
}

export function RolesMatrixPage() {
  const { data: me } = useMe()
  const { data, isPending, isError, error, refetch } = useRolePermissions()

  const groups = useMemo(() => (data ? groupPermissions(data) : []), [data])
  const grantSets = useMemo(() => {
    const sets = new Map<string, Set<string>>()
    if (data) for (const r of data.roles) sets.set(r.role, new Set(data.grants[r.role] ?? []))
    return sets
  }, [data])

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="flex min-h-0 flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Roles & Permissions</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-700">
            The three roles and what each one may do are fixed by the approved scope. Per-user permissions are not
            available, and this page cannot change anything. The server checks these permissions on every request.
          </p>
        </div>

        {isPending && (
          <p role="status" className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-700">
            Loading the role permission catalogue...
          </p>
        )}

        {isError && (
          <InlineAlert tone="error">
            Could not load the role permission catalogue: {error.message}{' '}
            <button type="button" onClick={() => refetch()} className="min-h-11 cursor-pointer font-medium underline">
              Try again
            </button>
          </InlineAlert>
        )}

        {data && (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.roles.map((r) => (
                <div key={r.role} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-xs">
                  <dt className="text-sm font-semibold text-neutral-800">{r.label}</dt>
                  <dd className="mt-1 text-sm text-neutral-700">
                    <span className="text-2xl font-bold text-[#5D0B26]">{grantSets.get(r.role)?.size ?? 0}</span> of{' '}
                    {data.permissions.length} permissions
                  </dd>
                </div>
              ))}
            </dl>

            <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-200 bg-white shadow-xs">
              <table className="w-full border-collapse text-left text-sm text-neutral-800">
                <caption className="sr-only">
                  Permission matrix: rows are permissions, columns are roles. Read only.
                </caption>
                <thead className="sticky top-0 z-10 bg-neutral-50 text-neutral-800">
                  <tr className="border-b border-neutral-200">
                    <th scope="col" className="px-4 py-3 font-semibold">Permission</th>
                    {data.roles.map((r) => (
                      <th key={r.role} scope="col" className="w-36 px-4 py-3 text-center font-semibold">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.name}>
                      <tr className="border-b border-neutral-200 bg-[#FFF8E7]">
                        <th
                          scope="colgroup"
                          colSpan={data.roles.length + 1}
                          className="px-4 py-2 font-semibold text-[#5D0B26]"
                        >
                          {g.name}
                        </th>
                      </tr>
                      {g.permissions.map((p) => (
                        <tr key={p.key} className="border-b border-neutral-100 hover:bg-neutral-50">
                          <th scope="row" className="px-4 py-2 font-normal">
                            <div className="text-neutral-900">{p.label}</div>
                            <div className="font-mono text-sm text-neutral-600">{p.key}</div>
                          </th>
                          {data.roles.map((r) => {
                            const granted = grantSets.get(r.role)?.has(p.key) ?? false
                            return (
                              <td key={r.role} className="px-4 py-2 text-center">
                                {granted ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-green-800">
                                    <span aria-hidden="true">✓</span>
                                    <span className="sr-only">{`${r.label}: allowed`}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-neutral-600">
                                    <span aria-hidden="true">✕</span>
                                    <span className="sr-only">{`${r.label}: not allowed`}</span>
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
