import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AdminPageLayout } from '../AdminPageLayout'

describe('AdminPageLayout', () => {
  it('renders a consistent administration breadcrumb, heading, description and actions', () => {
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <AdminPageLayout
          title="Clinic Settings"
          description="Manage hospital configuration."
          actions={<button type="button">Save changes</button>}
        >
          <section aria-label="Settings form">Settings form content</section>
        </AdminPageLayout>
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Administration / Clinic Settings',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Clinic Settings' })).toBeInTheDocument()
    expect(screen.getByText('Manage hospital configuration.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Settings form' })).toBeInTheDocument()
  })
})
