'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, User, Bot, Sparkles, MapPin, Info } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
}

export default function ChatInterface() {
  // Fresh session ID every page load — each reload starts a clean conversation
  const sessionId = useRef<string>(
    `guest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );

  const [managedSessionId, setManagedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Welcome to Marriott Lumina. I'm your premium AI concierge. How can I assist you with your Marriott experience today?",
      suggestions: ["Hotels in Paris, France", "Luxury beach resort in Maldives", "Romantic getaway in Rome"]
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Real API call
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sessionId.current, query: text, managedSessionId })
      });
      
      const data = await response.json();
      
      if (data.error) throw new Error(data.error);

      if (data.managedSessionId) setManagedSessionId(data.managedSessionId);

      const assistantMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.response,
        suggestions: data.suggestions
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (error: any) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: "I'm having a bit of trouble connecting to my service. Please ensure the backend is running and API keys are configured."
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass chat-container">
      {/* Header */}
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="avatar avatar-user" style={{ width: '40px', height: '40px' }}>
            <Sparkles size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '700' }}>Marriott Lumina</h1>
            <p style={{ fontSize: '11px', opacity: 0.7 }}>Premium AI Concierge</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
           <div className="suggestion-chip">Secure</div>
           <div className="suggestion-chip">Bonvoy Certified</div>
        </div>
      </div>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="chat-messages"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={msg.role === 'user' ? 'message-wrapper message-user' : 'message-wrapper'}
            >
              <div className="avatar" style={{ background: msg.role === 'user' ? 'var(--accent)' : 'var(--glass-border)', color: msg.role === 'user' ? 'var(--primary)' : 'inherit' }}>
                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <div className={msg.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-ai'}>
                  {msg.content.split('\n').map((line, i) => {
                    let formatted = line;
                    
                    // Horizontal rules
                    if (formatted.trim() === '---') {
                      return <hr key={i} className="markdown-rule" />;
                    }
                    
                    // Headings (any number of #)
                    if (formatted.startsWith('#')) {
                      const text = formatted.replace(/^#+\s*/, '');
                      return <span key={i} className="markdown-heading">{text}</span>;
                    }

                    // Bold text (global)
                    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    
                    // Cleanup trailing bold markers or empty artifacts
                    if (formatted.trim() === '**' || formatted.trim() === '*' || !formatted.trim()) {
                      return null;
                    }

                    // Bullet points (handle * or -)
                    if (formatted.trim().startsWith('* ') || formatted.trim().startsWith('- ')) {
                      const bulletText = formatted.trim().replace(/^[*|-]\s*/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                      return (
                        <p key={i} style={{ paddingLeft: '16px', position: 'relative', marginBottom: '4px' }}>
                          <span style={{ position: 'absolute', left: '0', color: 'var(--accent)' }}>•</span>
                          <span dangerouslySetInnerHTML={{ __html: bulletText }} />
                        </p>
                      );
                    }

                    // Fallback for regular lines
                    return (
                      <p key={i} dangerouslySetInnerHTML={{ __html: formatted }} style={{ marginBottom: '4px' }} />
                    );
                  })}
                </div>
                
                {msg.role === 'assistant' && msg.suggestions && (
                  <div className="suggestions">
                    {msg.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(suggestion)}
                        className="suggestion-chip"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="message-wrapper">
             <div className="bubble bubble-ai">
                <div style={{ display: 'flex', gap: '4px' }}>
                  <div className="avatar-user" style={{ width: '6px', height: '6px', borderRadius: '50%' }} />
                  <div className="avatar-user" style={{ width: '6px', height: '6px', borderRadius: '50%' }} />
                  <div className="avatar-user" style={{ width: '6px', height: '6px', borderRadius: '50%' }} />
                </div>
             </div>
          </motion.div>
        )}
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="input-wrapper"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Lumina about your next Marriott stay..."
            className="chat-input"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="send-button"
          >
            <Send size={18} />
          </button>
        </form>
        <p className="footer-text" style={{ marginTop: '16px' }}>
          Marriott International AI Concierge • Powered by WAT Framework
        </p>
      </div>
    </div>
  );
}
