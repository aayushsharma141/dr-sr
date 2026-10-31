import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

export function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6">
      <h1 className="text-2xl font-bold text-red-900">
        Kalyan Hospital Management System
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Offline LAN Platform v3.0
      </p>
    </div>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
