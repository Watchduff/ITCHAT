'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThumbsUp, ThumbsDown, Meh, Loader2, RefreshCw } from 'lucide-react';
import type { FeedbackRating } from '@/lib/feedback';

interface FeedbackRow {
  id: number;
  conversationId: string;
  rating: FeedbackRating;
  reason: string | null;
  comment: string | null;
  question: string | null;
  answer: string;
  createdAt: string;
}

const FILTERS: { value: FeedbackRating | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'partial', label: 'Partly' },
  { value: 'helpful', label: 'Helpful' },
];

const RATING_STYLE: Record<FeedbackRating, { icon: typeof ThumbsUp; label: string; className: string }> = {
  helpful: { icon: ThumbsUp, label: 'Helpful', className: 'text-green-700 bg-green-50 border-green-200' },
  partial: { icon: Meh, label: 'Partly', className: 'text-amber-700 bg-amber-50 border-amber-200' },
  not_helpful: { icon: ThumbsDown, label: 'Not helpful', className: 'text-red-700 bg-red-50 border-red-200' },
};

// Status scale (good -> warning -> critical), not brand color — same hexes used for the bars and badges.
const STATUS_COLOR: Record<FeedbackRating, string> = {
  helpful: '#0ca30c',
  partial: '#fab219',
  not_helpful: '#d03b3b',
};

const CHART_ORDER: FeedbackRating[] = ['helpful', 'partial', 'not_helpful'];

function FeedbackChart({ rows }: { rows: FeedbackRow[] }) {
  const total = rows.length;
  const counts = useMemo(() => {
    const c: Record<FeedbackRating, number> = { helpful: 0, partial: 0, not_helpful: 0 };
    for (const r of rows) c[r.rating]++;
    return c;
  }, [rows]);
  const max = Math.max(1, ...CHART_ORDER.map((k) => counts[k]));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-navy">Feedback by rating</h2>
        <span className="text-xs text-gray-400">{total} total</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-gray-400 py-2">No feedback yet.</p>
      ) : (
        <div className="space-y-3">
          {CHART_ORDER.map((rating) => {
            const { icon: Icon, label } = RATING_STYLE[rating];
            const count = counts[rating];
            const pct = Math.round((count / total) * 100);
            const widthPct = (count / max) * 100;
            return (
              <div
                key={rating}
                className="flex items-center gap-3"
                title={`${label}: ${count} of ${total} (${pct}%)`}
              >
                <span className="w-24 shrink-0 flex items-center gap-1.5 text-xs text-gray-600">
                  <Icon size={13} style={{ color: STATUS_COLOR[rating] }} /> {label}
                </span>
                <div className="flex-1 h-3 rounded-sm bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-r-sm transition-[width] duration-300"
                    style={{ width: `${widthPct}%`, backgroundColor: STATUS_COLOR[rating] }}
                  />
                </div>
                <span className="w-24 shrink-0 text-xs text-gray-500 text-right tabular-nums">
                  {count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedbackRating | 'all'>('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) throw new Error('Failed to load feedback.');
      setRows(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.rating !== filter) return false;
      if (!q) return true;
      return (
        r.question?.toLowerCase().includes(q) ||
        r.answer.toLowerCase().includes(q) ||
        r.comment?.toLowerCase().includes(q) ||
        r.reason?.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, helpful: 0, partial: 0, not_helpful: 0 };
    for (const r of rows) c[r.rating] = (c[r.rating] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-crimson text-white px-4 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="font-semibold text-sm leading-tight">Feedback Log</h1>
          <p className="text-xs text-white/80 leading-tight">
            OIT Help Desk Assistant — unauthenticated admin view, do not share this link
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <FeedbackChart rows={rows} />

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === f.value
                    ? 'border-crimson bg-crimson text-white'
                    : 'border-gray-300 text-gray-600 hover:border-crimson'
                }`}
              >
                {f.label} ({counts[f.value] ?? 0})
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search question, answer, comment…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-crimson sm:w-64"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">No feedback matches this filter.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const style = RATING_STYLE[r.rating];
              const Icon = style.icon;
              return (
                <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2 shadow-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${style.className}`}>
                      <Icon size={13} /> {style.label}
                    </div>
                    <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>

                  {r.reason && (
                    <span className="inline-block rounded-full border border-gray-300 text-gray-600 px-2.5 py-0.5 text-xs">
                      {r.reason}
                    </span>
                  )}

                  {r.question && (
                    <p className="text-sm">
                      <span className="font-medium text-navy">Q: </span>
                      {r.question}
                    </p>
                  )}
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-navy">A: </span>
                    {r.answer}
                  </p>

                  {r.comment && (
                    <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700">
                      {r.comment}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
