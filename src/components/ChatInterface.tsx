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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Welcome to Marriott Lumina. I'm your premium AI concierge. How can I assist you with your Marriott experience today?",
      suggestions: ["Find a hotel in Paris", "What are the best beach resorts?", "How do I check my Bonvoy points?"]
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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'guest@example.com', query: text })
      });
      
      const data = await response.json();
      
      if (data.error) throw new Error(data.error);

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
    <div className="flex flex-col h-[80vh] w-full max-w-4xl mx-auto glass shadow-2xl overflow-hidden mt-10">
      {/* Header */}
      <div className="p-6 border-b border-white/10 flex items-center justify-between premium-gradient">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shadow-lg">
            <Sparkles className="text-primary w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Marriott Lumina</h1>
            <p className="text-xs opacity-70">Premium AI Concierge</p>
          </div>
        </div>
        <div className="flex gap-2">
           <div className="px-3 py-1 rounded-full bg-white/5 text-[10px] uppercase tracking-widest border border-white/10">Secure</div>
           <div className="px-3 py-1 rounded-full bg-white/5 text-[10px] uppercase tracking-widest border border-white/10">Bonvoy Certified</div>
        </div>
      </div>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user' ? 'bg-accent' : 'bg-white/10'
                }`}>
                  {msg.role === 'user' ? <User size={16} className="text-primary" /> : <Bot size={16} />}
                </div>
                <div className="space-y-3">
                  <div className={`p-4 rounded-2xl shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-accent text-primary font-medium rounded-tr-none' 
                      : 'bg-white/5 border border-white/10 rounded-tl-none'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  </div>
                  
                  {msg.role === 'assistant' && msg.suggestions && (
                    <div className="flex flex-wrap gap-2">
                      {msg.suggestions.map((suggestion, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(suggestion)}
                          className="text-[11px] px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-accent transition-all"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
             <div className="bg-white/5 p-4 rounded-2xl rounded-tl-none border border-white/10">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
             </div>
          </motion.div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-white/10 bg-black/20">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Lumina about your next Marriott stay..."
            className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-6 pr-14 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all placeholder:text-white/30"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-accent rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={18} className="text-primary" />
          </button>
        </form>
        <p className="text-[10px] text-center mt-4 text-white/20 uppercase tracking-[0.2em]">
          Marriott International AI Concierge • Powered by WAT Framework
        </p>
      </div>
    </div>
  );
}
