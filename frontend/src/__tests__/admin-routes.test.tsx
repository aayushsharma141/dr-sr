import { isValidElement } from 'react'
import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import { router } from '../router'
import { RequireRole } from '../auth/guards'

/** Every route path, with the RequireRole roles of the groups it sits in. */
function walk(routes: RouteObject[], roles: unknown[] = []): { path: string; roles: unknown[]; route: RouteObject }[] {
  return routes.flatMap((route) => {
    const element = route.element
    const guard =
      isValidElement(element) && element.type === RequireRole
        ? [(element.props as { role: unknown }).role]
        : []
    const here = [...roles, ...guard]
    const self = route.path ? [{ path: route.path, roles: here, route }] : []
    return [...self, ...walk(route.children ?? [], here)]
  })
}

describe('admin routes', () => {
  const routes = walk(router.routes)

  it('mounts the Departments page at /admin/departments, inside the ADMIN group', async () => {
    const entry = routes.find((r) => r.path === '/admin/departments')
    expect(entry, 'the sidebar links to /admin/departments, so it must be a route').toBeDefined()
    expect(entry!.roles).toContain('ADMIN')

    const loaded = await (entry!.route.lazy as () => Promise<{ Component: unknown }>)()
    const { DepartmentsPage } = await import('../pages/admin/DepartmentsPage')
    expect(loaded.Component).toBe(DepartmentsPage)
  })
})
