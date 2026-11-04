import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from './api/queries'
import { router } from './router'
import { ReceiptHost } from './components/ReceiptHost'
import './index.css'
import './print.css'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ReceiptHost />
      </QueryClientProvider>
    </StrictMode>,
  )
}
