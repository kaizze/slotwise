'use client';

import { useEffect, useRef, useState } from 'react';
import { adminAssistantApi, ApiError } from '@/lib/api-client';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const SUGGESTIONS = [
  'How many free slots tomorrow?',
  "Who hasn't visited in 3 months?",
  'Move all Friday bookings to Maria.',
  'Show my busiest service.',
];

export function AdminAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const result = await adminAssistantApi.chat({
        messages: nextMessages,
        history,
      });
      setMessages(result.messages);
      setHistory(result.history ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the assistant.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>AI Assistant</h1>
          <p style={styles.subtitle}>
            Ask about free slots, lapsed customers, busy services, or schedule moves.
          </p>
        </div>
      </header>

      <div style={styles.panel}>
        <div style={styles.messages} role="log" aria-live="polite">
          {messages.length === 0 && !loading && (
            <div style={styles.empty}>
              <div style={styles.emptyTitle}>Try one of these</div>
              <div style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    style={styles.suggestion}
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              style={message.role === 'user' ? styles.rowUser : styles.rowAssistant}
            >
              <div style={message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>
                {message.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={styles.rowAssistant}>
              <div style={styles.bubbleAssistant}>Thinking…</div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form
          style={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            ref={inputRef}
            style={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your assistant…"
            disabled={loading}
            autoFocus
          />
          <button type="submit" style={styles.send} disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 820,
    margin: '0 auto',
    padding: '28px 24px 40px',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    minHeight: 'calc(100vh - 0px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 650,
  },
  subtitle: {
    margin: '6px 0 0',
    color: 'var(--ink-muted)',
    fontSize: 13,
  },
  panel: {
    flex: 1,
    minHeight: 520,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background:
      'radial-gradient(circle at top right, rgba(99,102,241,0.06), transparent 40%), var(--surface)',
  },
  empty: {
    margin: 'auto 0',
    padding: '12px 4px 24px',
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink-muted)',
    marginBottom: 12,
  },
  suggestions: {
    display: 'grid',
    gap: 8,
  },
  suggestion: {
    textAlign: 'left',
    border: '1px solid var(--border)',
    background: '#fff',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 14px',
    fontSize: 14,
    cursor: 'pointer',
    color: 'var(--ink)',
  },
  rowUser: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  rowAssistant: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  bubbleUser: {
    maxWidth: '80%',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    borderRadius: '14px 14px 4px 14px',
    padding: '10px 14px',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  bubbleAssistant: {
    maxWidth: '85%',
    background: '#f4f4f5',
    color: 'var(--ink)',
    borderRadius: '14px 14px 14px 4px',
    padding: '10px 14px',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  error: {
    margin: '0 16px 8px',
    padding: '10px 12px',
    background: 'var(--danger-bg)',
    color: 'var(--danger)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 13,
  },
  composer: {
    display: 'flex',
    gap: 8,
    padding: 14,
    borderTop: '1px solid var(--border)',
    background: '#fafafa',
  },
  input: {
    flex: 1,
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '11px 14px',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
  },
  send: {
    border: 'none',
    borderRadius: 999,
    padding: '0 18px',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
};
