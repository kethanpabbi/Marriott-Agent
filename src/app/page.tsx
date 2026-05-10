import ChatInterface from '@/components/ChatInterface';
import { Sparkles } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      
      {/* Top Brand Bar */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-8 animate-in fade-in slide-in-from-top-4 duration-1000">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black tracking-tighter italic">MARRIOTT</span>
          <span className="h-4 w-[1px] bg-white/20 mx-2" />
          <span className="text-sm uppercase tracking-[0.3em] opacity-60">International</span>
        </div>
        <div className="flex items-center gap-4 text-xs uppercase tracking-widest opacity-50 font-medium">
          <span>Hotels</span>
          <span>Experiences</span>
          <span className="text-accent opacity-100 flex items-center gap-1">
            <Sparkles size={12} /> Lumina AI
          </span>
        </div>
      </div>

      <ChatInterface />

      {/* Footer Info */}
      <div className="mt-12 text-center space-y-2 opacity-30 hover:opacity-100 transition-opacity duration-500 cursor-default">
         <p className="text-[10px] uppercase tracking-[0.4em]">Excellence • Hospitality • Innovation</p>
         <p className="text-[9px]">© 2026 Marriott International. All rights reserved.</p>
      </div>
    </main>
  );
}
