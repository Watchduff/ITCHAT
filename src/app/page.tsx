'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Trash2, Menu, X, Send, Loader2, LifeBuoy } from 'lucide-react';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

const SUGGESTIONS = [
  'SMS MFA codes are intermittently failing',
  "Student can't update office location in Workday",
  'ASUS Housing router setup issue',
  'NetID / password recovery steps',
];

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/conversations');
      const data: Conversation[] = await res.json();
      if (data.length > 0) {
        setConversations(data);
        setActiveId(data[0].id);
      } else {
        const created = await fetch('/api/conversations', { method: 'POST' }).then((r) => r.json());
        setConversations([created]);
        setActiveId(created.id);
      }
    })();
  }, []);

  async function refreshConversations() {
    const res = await fetch('/api/conversations');
    setConversations(await res.json());
  }

  async function createConversation() {
    const created = await fetch('/api/conversations', { method: 'POST' }).then((r) => r.json());
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setSidebarOpen(false);
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (id === activeId) {
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
      } else {
        await createConversation();
      }
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={`fixed md:static inset-y-0 left-0 z-30 w-72 bg-burgundy text-white flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4 flex items-center justify-between border-b border-white/10">
          <span className="font-semibold text-sm tracking-wide">CONVERSATIONS</span>
          <button className="md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>

        <button
          onClick={createConversation}
          className="m-3 flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-sm transition-colors"
        >
          <Plus size={16} /> New chat
        </button>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveId(c.id);
                setSidebarOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group transition-colors ${
                c.id === activeId ? 'bg-white/20' : 'hover:bg-white/10'
              }`}
            >
              <span className="truncate">{c.title}</span>
              <Trash2
                size={14}
                className="opacity-0 group-hover:opacity-70 hover:opacity-100 shrink-0 ml-2"
                onClick={(e) => deleteConversation(c.id, e)}
              />
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-crimson text-white px-4 py-3 flex items-center gap-3 shadow-sm shrink-0">
          <button className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            <Menu size={20} />
          </button>
          <LifeBuoy size={20} />
          <div>
            <h1 className="font-semibold text-sm leading-tight">OIT Help Desk Assistant</h1>
            <p className="text-xs text-white/80 leading-tight">KB-grounded troubleshooting for IT staff</p>
          </div>
        </header>

        {activeId ? (
          <ChatPanel key={activeId} conversationId={activeId} onExchangeComplete={refreshConversations} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        )}
      </div>
    </div>
  );
}

function ChatPanel({
  conversationId,
  onExchangeComplete,
}: {
  conversationId: string;
  onExchangeComplete: () => void;
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>('ready');

  const { messages, sendMessage, status, setMessages } = useChat({
    id: conversationId,
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/messages?conversationId=${conversationId}`);
      const history = await res.json();
      setMessages(history);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (prevStatusRef.current !== 'ready' && status === 'ready') {
      onExchangeComplete();
    }
    prevStatusRef.current = status;
  }, [status, onExchangeComplete]);

  const isBusy = status === 'streaming' || status === 'submitted';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    sendMessage({ text: input });
    setInput('');
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="max-w-xl mx-auto text-center mt-16 space-y-6">
            <h2 className="text-xl font-semibold text-navy">How can I help with this ticket?</h2>
            <p className="text-sm text-gray-500">
              Ask about any OIT knowledge base topic — MFA, RingCentral, Housing routers, Workday, student labor
              issues, and more.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white hover:border-crimson hover:text-crimson transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'bg-crimson text-white'
                      : 'bg-white border border-gray-200 shadow-sm prose prose-sm max-w-none'
                  }`}
                >
                  {m.parts.map((part, i) =>
                    part.type === 'text' ? (
                      m.role === 'assistant' ? (
                        <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                          {part.text}
                        </ReactMarkdown>
                      ) : (
                        <span key={i}>{part.text}</span>
                      )
                    ) : null
                  )}
                </div>
              </div>
            ))}
            {isBusy && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white p-3 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the ticket issue..."
            className="flex-1 border border-gray-300 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-crimson"
            disabled={isBusy}
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            className="bg-crimson text-white rounded-full p-2.5 disabled:opacity-40 hover:bg-burgundy transition-colors"
            aria-label="Send message"
          >
            {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </form>
    </>
  );
}
