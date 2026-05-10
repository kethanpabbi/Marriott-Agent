import ChatInterface from '@/components/ChatInterface';
import { Sparkles } from 'lucide-react';

export default function Home() {
  return (
    <main className="container">
      {/* Top Brand Bar */}
      <div className="brand-bar animate-in fade-in slide-in-from-top-4 duration-1000">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '24px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-0.05em' }}>MARRIOTT</span>
          <span style={{ height: '16px', width: '1px', background: 'rgba(255, 255, 255, 0.2)', margin: '0 8px' }} />
          <span style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.3em', opacity: 0.6 }}>International</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.2em', opacity: 0.5 }}>
          <span>Hotels</span>
          <span>Experiences</span>
          <span style={{ color: 'var(--accent)', opacity: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={12} /> Lumina AI
          </span>
        </div>
      </div>

      <ChatInterface />

      {/* Footer Info */}
      <div className="footer-text" style={{ marginTop: '32px' }}>
         <p style={{ letterSpacing: '0.4em' }}>Excellence • Hospitality • Innovation</p>
         <p style={{ marginTop: '8px', fontSize: '9px' }}>© 2026 Marriott International. All rights reserved.</p>
      </div>
    </main>
  );
}
