'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '@/lib/store';

const principleTitles = [
  'Unsafe retries and side effects',
  'Retrying writes can create duplicate payments, tickets, or records.',
  'Risk classification; idempotency keys where supported; no blind retries of non-idempotent writes.',
  'Tests prove writes are not replayed without safe idempotency conditions.',
];

function getBodies({ apis, metrics, events, connection, bootstrapped }) {
  const writeTools = apis.reduce((count, api) => count + (api.tools ?? []).filter((tool) => tool.sideEffects === 'write').length, 0);
  const eventCount = events.length;
  const halted = metrics?.halted ?? 0;
  const healed = metrics?.healed ?? 0;
  const state = connection === 'live' ? 'Live event stream connected.' : connection === 'offline' ? 'Live event stream unavailable.' : 'Connecting to the live event stream.';

  return [
    bootstrapped ? `${writeTools} registered write ${writeTools === 1 ? 'operation is' : 'operations are'} tracked for replay safety. ${state}` : 'Loading registered write operations and live safety state.',
    metrics?.calls ? `${healed} call${healed === 1 ? '' : 's'} healed and ${halted} halted across ${metrics.calls} observed call${metrics.calls === 1 ? '' : 's'}.` : 'Waiting for the first gateway call before reporting retry outcomes.',
    writeTools ? `${writeTools} write ${writeTools === 1 ? 'operation uses' : 'operations use'} registered risk metadata; non-idempotent writes remain in the guarded path.` : 'Register an API to classify write risk and apply idempotency rules.',
    `${eventCount} gateway event${eventCount === 1 ? '' : 's'} received in this session. Verified fixes and safe halts are reflected here in real time.`,
  ];
}

const principles = principleTitles.map((title, index) => ({ title, index }));

export function PrinciplesCarousel() {
  const { apis, metrics, events, conn: connection, bootstrapped } = useStore();
  const bodies = getBodies({ apis, metrics, events, connection, bootstrapped });
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const move = (direction) => {
    const nextIndex = Math.max(0, Math.min(principles.length - 1, activeIndex + direction));
    setActiveIndex(nextIndex);
    trackRef.current?.children[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  const select = (index) => {
    setActiveIndex(index);
    trackRef.current?.children[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  return <section className="principles-carousel" aria-label="Safe retry principles" aria-roledescription="carousel">
    <div className="principles-carousel-head">
      <div>
        <div className="section-label">SAFETY PRINCIPLES</div>
        <h2>Writes need proof before replay</h2>
      </div>
      <div className="principles-controls">
        <button type="button" className="principles-control" onClick={() => move(-1)} disabled={activeIndex === 0} aria-label="Previous safety principle" title="Previous safety principle"><ChevronLeft size={18} /></button>
        <button type="button" className="principles-control" onClick={() => move(1)} disabled={activeIndex === principles.length - 1} aria-label="Next safety principle" title="Next safety principle"><ChevronRight size={18} /></button>
      </div>
    </div>
    <div className="principles-track" ref={trackRef} tabIndex="0" onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); }}>
      {principles.map((principle, index) => <article className="principles-slide" key={principle.title} aria-label={`Principle ${index + 1} of ${principles.length}`}>
        <h3>{principle.title}</h3>
        <p aria-live="polite">{bodies[index]}</p>
      </article>)}
    </div>
    <div className="principles-pagination" aria-label="Safety principle position">
      {principles.map((principle, index) => <button type="button" key={principle.title} className={index === activeIndex ? 'active' : ''} onClick={() => select(index)} aria-label={`Go to principle ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined} />)}
    </div>
  </section>;
}
