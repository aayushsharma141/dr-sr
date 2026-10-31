import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

export function App() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <h1 className="text-2xl font-bold text-slate-900">Kalyan Hospital Management System</h1>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
