import { describe, expect, it } from 'vitest'
import {
  ADMIN_MODULES,
  findAdminModuleForPath,
  navigableAdminModules,
  ownedAdminPaths,
} from '../../admin/modules'

describe('admin module registry', () => {
  it('lists the 12 modules in order with the agreed groups', () => {
    expect(ADMIN_MODULES.map((m) => m.number)).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
    ])
    const byGroup = (group: 'hospital' | 'system') =>
      ADMIN_MODULES.filter((m) => m.group === group).map((m) => m.number)
    expect(byGroup('hospital')).toEqual(['01', '03', '04', '05', '06', '07', '08'])
    expect(byGroup('system')).toEqual(['02', '09', '10', '11', '12'])
  })

  it('marks 05 and 07 fixed by requirement, with no pages and a stated reason', () => {
    const fixed = ADMIN_MODULES.filter((m) => m.status === 'fixed')
    expect(fixed.map((m) => m.number)).toEqual(['05', '07'])
    for (const module of fixed) {
      expect(module.links).toEqual([])
      expect(module.statusReason).toBeTruthy()
    }
    expect(fixed[0].statusReason).toBe(
      'Fixed by requirement APT-02; configuration awaits client decision',
    )
  })

  it('never offers fixed modules for navigation', () => {
    const numbers = navigableAdminModules().map((m) => m.number)
    expect(numbers).not.toContain('05')
    expect(numbers).not.toContain('07')
    expect(numbers).toHaveLength(10)
  })

  it('resolves each admin page to exactly one owning module', () => {
    expect(findAdminModuleForPath('/admin')?.module.number).toBe('01')
    expect(findAdminModuleForPath('/admin/users')?.module.number).toBe('02')
    expect(findAdminModuleForPath('/admin/roles')?.module.number).toBe('02')
    expect(findAdminModuleForPath('/admin/settings')?.module.number).toBe('03')
    expect(findAdminModuleForPath('/admin/doctors')?.module.number).toBe('04')
    expect(findAdminModuleForPath('/reception/dues')?.module.number).toBe('06')
    expect(findAdminModuleForPath('/admin/security')?.module.number).toBe('09')
    expect(findAdminModuleForPath('/admin/audit')?.module.number).toBe('10')
    expect(findAdminModuleForPath('/admin/backups')?.module.number).toBe('11')
    expect(findAdminModuleForPath('/admin/integrity')?.link.label).toBe('Data integrity')
    expect(findAdminModuleForPath('/admin/system')?.module.number).toBe('12')
    expect(findAdminModuleForPath('/admin/unknown')).toBeNull()
    expect(findAdminModuleForPath('/administer')).toBeNull()
  })

  it('cross-reference modules own no admin page of their own', () => {
    const billing = ADMIN_MODULES.find((m) => m.number === '06')!
    const print = ADMIN_MODULES.find((m) => m.number === '08')!
    expect(ownedAdminPaths(billing)).toEqual(['/reception/dues'])
    expect(ownedAdminPaths(print)).toEqual([])
  })
})
