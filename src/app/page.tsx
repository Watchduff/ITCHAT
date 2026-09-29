'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  FormEvent,
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus,
  Trash2,
  Menu,
  X,
  Send,
  Loader2,
  LifeBuoy,
  ThumbsUp,
  ThumbsDown,
  Meh,
  Search,
  Copy,
  Check,
  User,
  ShieldCheck,
  Briefcase,
  Wifi,
  KeyRound,
  CircleAlert,
  RotateCcw,
  ImagePlus,
} from 'lucide-react';
import { FEEDBACK_REASONS, MAX_FEEDBACK_COMMENT_LENGTH, type FeedbackRating } from '@/lib/feedback';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

const SUGGESTIONS = [
  { text: 'SMS MFA codes are intermittently failing', topic: 'MFA', icon: ShieldCheck },
  { text: "Student can't update office location in Workday", topic: 'Workday', icon: Briefcase },
  { text: 'ASUS Housing router setup issue', topic: 'Housing network', icon: Wifi },
  { text: 'NetID / password recovery steps', topic: 'Accounts', icon: KeyRound },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// The last few turns are enough context to guess what the technician will answer next.
const SUGGESTION_CONTEXT_MESSAGES = 4;

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function messageImages(message: UIMessage): FileUIPart[] {
  return message.parts.filter(
    (part): part is FileUIPart => part.type === 'file' && part.mediaType.startsWith('image/')
  );
}

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_DIMENSION = 1600;
// Past this size a PNG screenshot is re-encoded as JPEG to keep requests light.
const MAX_PNG_DATA_URL_LENGTH = 1_500_000;
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

// Downscale in the browser so a 4K screenshot doesn't become a multi-megabyte request
// on every turn; the model reads error dialogs fine at this size.
async function imageToAttachment(file: File): Promise<FileUIPart> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Screenshots are mostly flat UI and text, which PNG keeps crisp; photos fall back to JPEG.
  let mediaType = 'image/png';
  let url = canvas.toDataURL(mediaType);
  if (url.length > MAX_PNG_DATA_URL_LENGTH) {
    mediaType = 'image/jpeg';
    url = canvas.toDataURL(mediaType, 0.85);
  }
  return { type: 'file', mediaType, url, filename: file.name || 'screenshot' };
}

const DATE_BUCKET_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'] as const;

function dateBucket(createdAt: string): (typeof DATE_BUCKET_ORDER)[number] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(new Date(createdAt))) / 86_400_000);

  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo <= 7) return 'Previous 7 days';
  if (daysAgo <= 30) return 'Previous 30 days';
  return 'Older';
}

// A conversation still on its default title hasn't had a first message yet —
// showing that in the header would read as a stuck app, not an empty ticket.
const UNTITLED_CONVERSATION = 'New conversation';

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Delete is two clicks: the first arms it, the second (within a few seconds) confirms.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      setConversationsLoaded(true);
    })();
  }, []);

  // Cmd/Ctrl+K jumps straight to the conversation search, opening the sidebar on mobile if needed.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setSidebarOpen(true);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => () => {
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
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
    setSearchQuery('');
  }

  function selectConversation(id: string) {
    setConfirmDeleteId(null);
    setActiveId(id);
    setSidebarOpen(false);
  }

  async function deleteConversation(id: string) {
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

  function handleDeleteClick(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);

    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      deleteConversation(id);
      return;
    }
    setConfirmDeleteId(id);
    confirmDeleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 4000);
  }

  const groupedConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;

    const buckets = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const bucket = dateBucket(c.createdAt);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(c);
    }
    return DATE_BUCKET_ORDER.map((label) => ({ label, items: buckets.get(label) ?? [] })).filter(
      (g) => g.items.length > 0
    );
  }, [conversations, searchQuery]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const headerTitle =
    activeConversation && activeConversation.title !== UNTITLED_CONVERSATION
      ? activeConversation.title
      : 'OIT Help Desk Assistant';

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-fg">
      <aside
        className={`fixed md:static inset-y-0 left-0 z-30 w-72 bg-sidebar border-r border-line text-fg flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent text-white shrink-0">
            <LifeBuoy size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">OIT Help Desk</p>
            <p className="text-xs text-faint leading-tight">Your ticket sidekick</p>
          </div>
          <button
            className="md:hidden p-1 rounded-md text-muted hover:text-fg hover:bg-elevated"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 pb-3 border-b border-line space-y-2">
          <button
            onClick={createConversation}
            className="w-full flex items-center gap-2 rounded-lg border border-line-strong bg-elevated text-fg font-medium hover:border-accent-text/50 hover:bg-[#383e48] px-3 py-2.5 text-sm transition-colors"
          >
            <Plus size={16} /> New chat
          </button>


          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              title="Search conversations (Ctrl+K)"
              className="w-full bg-canvas border border-line placeholder:text-faint text-fg text-sm rounded-lg pl-8 pr-12 py-2 focus:outline-none focus:border-line-strong focus:ring-1 focus:ring-accent-text/30 transition-colors"
            />
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="hidden md:block absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none rounded border border-line-strong px-1.5 text-[10px] font-sans text-faint">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pt-3">
          {!conversationsLoaded ? (
            <div className="px-3 py-2 space-y-2 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-elevated" />
              ))}
            </div>
          ) : groupedConversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-faint">
              {searchQuery ? `Nothing matches “${searchQuery}”. Try another word?` : 'No conversations yet. Start one above!'}
            </p>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.label} className="mb-3 last:mb-0">
                <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((c) => (
                    <div
                      key={c.id}
                      className={`relative flex items-center rounded-lg text-sm group transition-colors ${
                        c.id === activeId
                          ? 'bg-elevated text-fg before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-accent-text'
                          : 'text-muted hover:bg-elevated/60 hover:text-fg'
                      }`}
                    >
                      <button
                        onClick={() => selectConversation(c.id)}
                        title={c.title}
                        className="flex-1 min-w-0 text-left px-3 py-2.5 truncate"
                      >
                        {c.title}
                      </button>
                      {confirmDeleteId === c.id ? (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(c.id, e)}
                          className="shrink-0 mr-2 rounded-full bg-red-500 hover:bg-red-600 text-white text-[10px] font-medium px-2 py-1 transition-colors"
                        >
                          Confirm delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(c.id, e)}
                          aria-label={`Delete "${c.title}"`}
                          title="Delete conversation"
                          className="shrink-0 mr-1.5 p-1.5 rounded text-faint opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-canvas/80 backdrop-blur border-b border-line px-4 py-3 flex items-center gap-3 shrink-0">
          <button
            className="md:hidden p-1 -ml-1 rounded-md text-muted hover:text-fg hover:bg-elevated"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm leading-tight truncate text-fg">{headerTitle}</h1>
            <p className="text-xs text-faint leading-tight flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
              Answers grounded in the OIT knowledge base
            </p>
          </div>
          <button
            onClick={createConversation}
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-line-strong hover:text-fg hover:bg-elevated transition-colors"
          >
            <Plus size={14} /> New chat
          </button>
        </header>

        {activeId ? (
          <ChatPanel key={activeId} conversationId={activeId} onExchangeComplete={refreshConversations} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-faint text-sm">
            <Loader2 size={20} className="animate-spin text-accent-text" />
            Getting things ready…
          </div>
        )}
      </div>

    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/15 text-accent-text ring-1 ring-accent/30 shrink-0">
      <LifeBuoy size={16} />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-elevated text-muted ring-1 ring-line-strong shrink-0">
      <User size={16} />
    </div>
  );
}

// Answers usually end up pasted into ticket notes, so copying should be one click.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); the text is still selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint hover:text-fg hover:bg-elevated transition-colors"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const RATING_OPTIONS: { rating: FeedbackRating; label: string; icon: typeof ThumbsUp }[] = [
  { rating: 'helpful', label: 'Yes', icon: ThumbsUp },
  { rating: 'partial', label: 'Partly', icon: Meh },
  { rating: 'not_helpful', label: 'No', icon: ThumbsDown },
];

function FeedbackPopup({
  conversationId,
  onClose,
  raised,
}: {
  conversationId: string;
  onClose: () => void;
  raised: boolean;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
  }, [submitted, onClose]);

  async function submit(finalRating: FeedbackRating) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          rating: finalRating,
          reason: finalRating === 'helpful' ? null : reason,
          comment: comment.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Could not save feedback.');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feedback.');
    } finally {
      setSubmitting(false);
    }
  }

  function pickRating(r: FeedbackRating) {
    setRating(r);
    // A positive rating needs no follow-up, so it is sent right away.
    if (r === 'helpful') submit(r);
  }

  return (
    <div
      role="dialog"
      aria-label="Answer feedback"
      className={`fixed right-4 left-4 sm:left-auto sm:w-80 z-10 bg-surface border border-line-strong rounded-2xl shadow-2xl shadow-black/50 p-4 transition-[bottom] animate-pop-in ${
        raised ? 'bottom-48' : 'bottom-28'
      }`}
    >
      <button onClick={onClose} aria-label="Dismiss feedback" className="absolute top-3 right-3 text-faint hover:text-fg">
        <X size={16} />
      </button>

      {submitted ? (
        <p className="flex items-center gap-2 text-sm text-fg py-2">
          <Check size={16} className="text-emerald-400 shrink-0" />
          Thanks! Your feedback helps us improve the assistant.
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-fg pr-6">Did this answer help with the ticket?</p>

          <div className="flex gap-2 mt-3">
            {RATING_OPTIONS.map(({ rating: r, label, icon: Icon }) => (
              <button
                key={r}
                onClick={() => pickRating(r)}
                disabled={submitting}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                  rating === r
                    ? 'border-accent bg-accent text-white'
                    : 'border-line-strong text-muted hover:border-accent-text/60 hover:text-fg'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {(rating === 'partial' || rating === 'not_helpful') && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {FEEDBACK_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(reason === r ? null : r)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      reason === r
                        ? 'border-accent-text/60 bg-accent/15 text-accent-text'
                        : 'border-line-strong text-muted hover:border-accent-text/60 hover:text-fg'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={MAX_FEEDBACK_COMMENT_LENGTH}
                rows={2}
                placeholder="What was wrong or missing? (optional)"
                className="w-full bg-canvas border border-line-strong rounded-lg px-3 py-2 text-sm text-fg placeholder:text-faint focus:outline-none focus:border-accent-text/60 resize-none"
              />
              <button
                onClick={() => submit(rating)}
                disabled={submitting}
                className="w-full bg-accent text-white rounded-lg py-2 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />} Send feedback
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

          <p className="text-[11px] leading-snug text-faint mt-3">
            Your rating, comment, and this question and answer are saved to the help desk assistant&apos;s
            feedback log so OIT can improve it. It is not linked to your name, but it may include ticket
            details you typed.
          </p>
        </>
      )}
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
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [draggingImage, setDraggingImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStatusRef = useRef<string>('ready');
  const [feedbackKey, setFeedbackKey] = useState<string | null>(null);
  // Tied to the message the replies answer, so replies for an older turn never linger.
  const [suggestionState, setSuggestionState] = useState<{ forMessageId: string; items: string[] }>({
    forMessageId: '',
    items: [],
  });

  const { messages, sendMessage, status, setMessages, error, regenerate, clearError } = useChat({
    id: conversationId,
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      if (message.role === 'assistant' && !isAbort && !isDisconnect && !isError) {
        setFeedbackKey(message.id);
      }
    },
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
  }, [messages, error]);

  // Grow the input with its content (up to a cap) so longer ticket descriptions stay readable.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (prevStatusRef.current !== 'ready' && status === 'ready') {
      onExchangeComplete();
    }
    prevStatusRef.current = status;
  }, [status, onExchangeComplete]);

  const isBusy = status === 'streaming' || status === 'submitted';

  const lastMessage = messages[messages.length - 1];
  // Quick replies only answer a finished assistant turn.
  const canSuggest = !isBusy && lastMessage?.role === 'assistant';
  const suggestionsReady = canSuggest && suggestionState.forMessageId === lastMessage.id;
  const suggestions = useMemo(
    () => (suggestionsReady ? suggestionState.items : []),
    [suggestionsReady, suggestionState.items]
  );
  const suggestionsLoading = canSuggest && !suggestionsReady;
  const showTypingIndicator =
    status === 'submitted' || (status === 'streaming' && (lastMessage?.role !== 'assistant' || !messageText(lastMessage)));

  // Offer clickable replies to whatever the assistant just asked, so the technician
  // can answer without typing while the caller is waiting.
  useEffect(() => {
    if (!canSuggest) return;

    const forMessageId = lastMessage.id;
    const context = messages
      .slice(-SUGGESTION_CONTEXT_MESSAGES)
      .map((m) => ({ role: m.role, text: messageText(m) }));
    const controller = new AbortController();

    (async () => {
      let items: string[] = [];
      try {
        const res = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ messages: context }),
        });
        if (res.ok) {
          const data: { suggestions?: unknown } = await res.json();
          if (Array.isArray(data.suggestions)) items = data.suggestions.filter((s) => typeof s === 'string');
        }
      } catch {
        // Quick replies are optional — the technician can still type.
      }
      // Recording the id even on failure stops the spinner instead of retrying forever.
      if (!controller.signal.aborted) setSuggestionState({ forMessageId, items });
    })();

    return () => controller.abort();
  }, [messages, canSuggest, lastMessage?.id]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && attachments.length === 0) || isBusy) return;
      setFeedbackKey(null);
      if (error) clearError();
      const files = attachments.length > 0 ? attachments : undefined;
      if (trimmed) {
        sendMessage({ text: trimmed, files });
      } else {
        sendMessage({ files: attachments });
      }
      setInput('');
      setAttachments([]);
      setAttachError(null);
      textareaRef.current?.focus();
    },
    [isBusy, sendMessage, error, clearError, attachments]
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) {
        if (files.length > 0) setAttachError('Only images can be attached.');
        return;
      }
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        setAttachError(`You can attach up to ${MAX_ATTACHMENTS} images per message.`);
        return;
      }

      const converted: FileUIPart[] = [];
      for (const file of images.slice(0, room)) {
        try {
          converted.push(await imageToAttachment(file));
        } catch {
          setAttachError(`Couldn't read ${file.name || 'that image'}.`);
        }
      }
      setAttachError(images.length > room ? `Only ${MAX_ATTACHMENTS} images fit in one message.` : null);
      setAttachments((prev) => [...prev, ...converted].slice(0, MAX_ATTACHMENTS));
      textareaRef.current?.focus();
    },
    [attachments.length]
  );

  // Ctrl+V a screenshot anywhere in the chat attaches it (other text fields keep normal paste).
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      const isOtherField =
        target !== textareaRef.current &&
        (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable);
      if (isOtherField || !e.clipboardData) return;

      const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      // Keep any text that came along; only suppress the paste when it's purely an image.
      if (!e.clipboardData.getData('text/plain')) e.preventDefault();
      addImages(images);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addImages]);

  useEffect(() => {
    if (!previewUrl) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewUrl(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewUrl]);

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    addImages(Array.from(e.target.files ?? []));
    e.target.value = '';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDraggingImage(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Ignore leave events fired when moving between child elements.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDraggingImage(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDraggingImage(false);
    addImages(Array.from(e.dataTransfer.files));
  }

  // Number-key shortcuts for the quick-reply chips, so a technician mid-call never
  // has to reach for the mouse. Digits are ignored while the technician is actually
  // typing, so they don't hijack normal ticket-note entry.
  useEffect(() => {
    if (suggestions.length === 0 || isBusy) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        setInput('');
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isEditable) return;

      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < suggestions.length) {
        e.preventDefault();
        send(suggestions[index]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [suggestions, isBusy, send]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  // Enter sends, Shift+Enter adds a line break — the usual chat convention.
  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingImage && (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent-text/60 bg-canvas/85 text-accent-text">
          <ImagePlus size={28} />
          <p className="text-sm font-medium">Drop screenshots to attach</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto text-center mt-10 sm:mt-20 animate-fade-in-up">
            <div className="mx-auto flex items-center justify-center w-11 h-11 rounded-xl bg-accent/15 text-accent-text ring-1 ring-accent/30">
              <LifeBuoy size={22} />
            </div>
            <h2 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
              {greeting()}. <span className="text-muted">What&apos;s the ticket?</span>
            </h2>
            <p className="mt-3 text-sm text-muted leading-relaxed max-w-lg mx-auto">
              Describe what the caller is seeing and I&apos;ll walk you through it using the OIT knowledge base: MFA,
              RingCentral, Housing routers, Workday, student labor, and more.
            </p>
            <p className="mt-10 mb-3 text-left text-xs font-medium uppercase tracking-wider text-faint">Common issues</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              {SUGGESTIONS.map(({ text, topic, icon: Icon }) => (
                <button
                  key={text}
                  onClick={() => send(text)}
                  className="group flex items-start gap-3 text-left border border-line rounded-xl px-4 py-3.5 bg-surface hover:bg-elevated hover:border-line-strong transition-colors"
                >
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-elevated text-muted shrink-0 group-hover:bg-accent/15 group-hover:text-accent-text transition-colors">
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium uppercase tracking-wider text-faint">
                      {topic}
                    </span>
                    <span className="block mt-0.5 text-sm leading-snug text-fg">
                      {text}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.map((m) => {
              const isUser = m.role === 'user';
              const text = messageText(m);
              const isStreamingThis = isBusy && m.id === lastMessage?.id && !isUser;
              const images = messageImages(m);
              // An assistant turn with no text yet is covered by the typing indicator below.
              if (!isUser && !text) return null;
              return (
                <div
                  key={m.id}
                  className={`flex items-start gap-3 animate-fade-in-up ${isUser ? 'flex-row-reverse' : ''}`}
                >
                  {isUser ? <UserAvatar /> : <AssistantAvatar />}
                  <div className={`flex flex-col min-w-0 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                    {images.length > 0 && (
                      <div className={`flex flex-wrap gap-2 mb-1.5 ${isUser ? 'justify-end' : ''}`}>
                        {images.map((img, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPreviewUrl(img.url)}
                            className="block overflow-hidden rounded-xl border border-line-strong hover:border-accent-text/60 transition-colors"
                            title="View full size"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- data URLs, nothing to optimize */}
                            <img
                              src={img.url}
                              alt={img.filename ? `Attached: ${img.filename}` : 'Attached screenshot'}
                              className="max-h-48 max-w-[16rem] object-contain bg-canvas"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {(text || !isUser) && (
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm ${
                          isUser
                            ? 'bg-elevated text-fg border border-line-strong rounded-tr-md whitespace-pre-wrap'
                            : 'bg-surface border border-line rounded-tl-md prose prose-sm prose-invert max-w-none prose-p:text-fg prose-li:text-fg prose-strong:text-white prose-a:text-accent-text prose-a:no-underline hover:prose-a:underline prose-code:text-accent-text prose-code:before:content-none prose-code:after:content-none prose-pre:bg-canvas prose-pre:border prose-pre:border-line prose-hr:border-line prose-th:text-fg prose-td:border-line'
                        }`}
                      >
                        {m.parts.map((part, i) =>
                          part.type === 'text' ? (
                            isUser ? (
                              <span key={i}>{part.text}</span>
                            ) : (
                              <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                                {part.text}
                              </ReactMarkdown>
                            )
                          ) : null
                        )}
                      </div>
                    )}
                    {!isUser && text && !isStreamingThis && (
                      <div className="mt-1">
                        <CopyButton text={text} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {showTypingIndicator && (
              <div className="flex items-start gap-3 animate-fade-in-up">
                <AssistantAvatar />
                <div className="bg-surface border border-line rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-3">
                  <span className="flex gap-1">
                    <span className="w-2 h-2 bg-accent-text/70 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-accent-text/70 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-accent-text/70 rounded-full animate-bounce" />
                  </span>
                  <span className="text-xs text-muted">Checking the knowledge base…</span>
                </div>
              </div>
            )}
            {error && !isBusy && (
              <div className="flex items-start gap-3 animate-fade-in-up">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 text-red-400 ring-1 ring-red-500/30 shrink-0">
                  <CircleAlert size={16} />
                </div>
                <div className="rounded-2xl rounded-tl-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  <p className="font-medium">Hmm, something went wrong on my end.</p>
                  <p className="text-xs text-red-300/80 mt-0.5">
                    It&apos;s probably a temporary hiccup. Give it another try.
                  </p>
                  <button
                    type="button"
                    onClick={() => regenerate()}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20 transition-colors"
                  >
                    <RotateCcw size={12} /> Try again
                  </button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {feedbackKey && (
        <FeedbackPopup
          key={feedbackKey}
          conversationId={conversationId}
          onClose={() => setFeedbackKey(null)}
          raised={suggestions.length > 0}
        />
      )}

      <div className="bg-canvas shrink-0">
        {(suggestionsLoading || suggestions.length > 0) && (
          <div className="max-w-3xl mx-auto px-3 pt-3">
            {suggestionsLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-faint">
                <Loader2 size={11} className="animate-spin" /> Finding quick replies…
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-[11px] font-medium uppercase tracking-wider text-faint"
                  title="Press the number key, or Esc to clear the input"
                >
                  Quick reply
                </span>
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    title={`Press ${i + 1}`}
                    className="group flex items-center gap-1.5 rounded-full border border-line-strong pl-1.5 pr-3 py-1.5 text-xs text-fg bg-surface hover:border-accent-text/60 hover:bg-accent/15 transition-colors"
                  >
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-elevated text-[10px] font-medium text-muted group-hover:bg-accent group-hover:text-white transition-colors">
                      {i + 1}
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="px-3 pt-3 pb-2">
          <div className="max-w-3xl mx-auto rounded-2xl border border-line-strong bg-surface shadow-lg shadow-black/30 focus-within:border-accent-text/50 focus-within:ring-2 focus-within:ring-accent/20 transition-shadow">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachments.map((a, i) => (
                  <div key={i} className="group relative">
                    <button
                      type="button"
                      onClick={() => setPreviewUrl(a.url)}
                      className="block h-16 w-16 overflow-hidden rounded-lg border border-line-strong"
                      title="Preview"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URLs, nothing to optimize */}
                      <img src={a.url} alt={a.filename ?? 'Screenshot to send'} className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove image"
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-elevated border border-line-strong text-muted hover:text-fg hover:bg-red-500/80"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1 pl-1.5 pr-1.5 py-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= MAX_ATTACHMENTS}
                aria-label="Attach screenshot"
                title="Attach screenshot (or paste with Ctrl+V)"
                className="shrink-0 rounded-xl p-2.5 text-muted hover:text-fg hover:bg-elevated disabled:opacity-40 transition-colors"
              >
                <ImagePlus size={18} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                rows={1}
                autoFocus
                placeholder={
                  messages.length === 0
                    ? 'What is the caller running into? You can paste a screenshot too'
                    : 'Add details, a screenshot, or ask a follow-up…'
                }
                aria-label="Message"
                className="flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-fg focus:outline-none placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={isBusy || (!input.trim() && attachments.length === 0)}
                className="bg-accent text-white rounded-xl p-2.5 disabled:bg-elevated disabled:text-faint hover:bg-accent-hover transition-colors shrink-0"
                aria-label="Send message"
              >
                {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </div>
          {attachError && <p className="max-w-3xl mx-auto mt-1.5 text-xs text-red-400">{attachError}</p>}
          <p className="max-w-3xl mx-auto mt-2 text-center text-[11px] text-faint">
            <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a new
            line · Paste or drop screenshots · Always double-check steps before sharing with a caller
          </p>
        </form>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-pop-in"
          onClick={() => setPreviewUrl(null)}
          role="dialog"
          aria-label="Image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URLs, nothing to optimize */}
          <img src={previewUrl} alt="Screenshot preview" className="max-h-[90vh] max-w-full rounded-lg shadow-2xl" />
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            aria-label="Close preview"
            className="absolute top-4 right-4 rounded-full bg-elevated/90 p-2 text-fg hover:bg-elevated"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
