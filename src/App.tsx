import { Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Overview from './pages/Overview'
import LiveDemo from './pages/LiveDemo'
import WorkflowPage from './pages/Workflow'
import SchemaRegistry from './pages/SchemaRegistry'
import LogsMetrics from './pages/LogsMetrics'

export default function App() {
  return (
    <div className="min-h-screen bg-ink-950">
      <Sidebar />
      <main className="pl-60">
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/demo" element={<LiveDemo />} />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/registry" element={<SchemaRegistry />} />
            <Route path="/logs" element={<LogsMetrics />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="mt-10 border-t border-ink-800 pt-4 pb-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
              Self-Healing Tool Registries · PS 01 · frontend prototype · all data simulated
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
