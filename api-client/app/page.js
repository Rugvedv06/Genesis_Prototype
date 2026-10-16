export default function Home() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
      <h1>api-client · Core Dashboard</h1>
      <p>Self-healing tool registry — PS 01. Scaffolded in Phase 0 (build plan). Port 3000.</p>
      <h2>Health checks</h2>
      <ul>
        <li>Core gateway: <a href="http://localhost:8000/health" target="_blank" rel="noopener noreferrer">:8000/health</a></li>
        <li>Mock server: <a href="http://localhost:5001/health" target="_blank" rel="noopener noreferrer">:5001/health</a></li>
      </ul>
      <h2>Status</h2>
      <p>Phase 0 complete: monorepo scaffolding, <code>/contracts</code> fixtures, <code>lib/paths.js</code> unit tested.</p>
      <p>Next: Phase 1 demoable vertical slice (M5 heal vs baseline) — see <code>PS01_BUILD_PLAN.md</code> §6.</p>
    </div>
  );
}
