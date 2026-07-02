import chatStyles from './chat-styles.css?inline';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SlotWiseChatConfig {
  businessSlug: string;
  apiBaseUrl?: string;
  accentColor?: string;
  lang?: 'el' | 'en';
  targetId?: string;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

const STRINGS = {
  el: {
    placeholder: 'Γράψτε το μήνυμά σας...',
    send: 'Αποστολή',
    greeting: 'Γεια σας! Πώς μπορώ να σας βοηθήσω;\n\nΜπορείτε να μου πείτε για παράδειγμα:\n• «Θέλω να κλείσω ραντεβού για κούρεμα την Παρασκευή»\n• «Ποιες θέσεις έχετε διαθέσιμες αυτή την εβδομάδα;»',
    error: 'Κάτι πήγε στραβά. Παρακαλώ δοκιμάστε ξανά.',
    poweredBy: 'Με τεχνολογία SlotWise AI',
  },
  en: {
    placeholder: 'Type your message...',
    send: 'Send',
    greeting: 'Hello! How can I help you?\n\nYou can say things like:\n• "I want to book a haircut this Friday"\n• "What slots are available this week?"',
    error: 'Something went wrong. Please try again.',
    poweredBy: 'Powered by SlotWise AI',
  },
} as const;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Light markdown: **bold**, bullet lines, newlines
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^• /gm, '<span class="swc-bullet">•</span> ')
    .replace(/\n/g, '<br>');
}

// ─── Widget class ─────────────────────────────────────────────────────────────

export class SlotWiseChatWidget {
  private config: SlotWiseChatConfig;
  private strings: typeof STRINGS['el'];
  private messages: AgentMessage[] = [];
  // Full Anthropic message history including tool calls — opaque to the widget,
  // just stored and sent back so the agent remembers what it already looked up.
  private history: unknown[] = [];
  private root: ShadowRoot;
  private host: HTMLElement;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private isThinking = false;

  constructor(config: SlotWiseChatConfig) {
    this.config = config;
    this.strings = STRINGS[config.lang ?? 'el'];

    const target = config.targetId ? document.getElementById(config.targetId) : null;

    this.host = document.createElement('div');
    this.host.setAttribute('id', 'slotwise-chat-host');

    if (target) {
      target.appendChild(this.host);
    } else {
      document.body.appendChild(this.host);
    }

    this.root = this.host.attachShadow({ mode: 'open' });
    this.render();
    this.appendMessage('assistant', this.strings.greeting);
  }

  private render(): void {
    const accent = this.config.accentColor ?? '#6366f1';

    const style = document.createElement('style');
    style.textContent = chatStyles
      .replace(/SW_ACCENT/g, accent)
      .replace(/SW_ACCENT_DARK/g, this.darken(accent));

    const panel = document.createElement('div');
    panel.className = 'swc-panel';
    panel.innerHTML = `
      <div class="swc-messages" role="log" aria-live="polite"></div>
      <div class="swc-input-row">
        <input
          type="text"
          class="swc-input"
          placeholder="${escapeHtml(this.strings.placeholder)}"
          autocomplete="off"
        />
        <button class="swc-send">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div class="swc-footer">${escapeHtml(this.strings.poweredBy)}</div>
    `;

    this.root.appendChild(style);
    this.root.appendChild(panel);

    this.messagesEl = panel.querySelector('.swc-messages');
    this.inputEl    = panel.querySelector('.swc-input');
    this.sendBtn    = panel.querySelector('.swc-send');

    this.inputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });
  }

  private async handleSend(): Promise<void> {
    if (this.isThinking || !this.inputEl) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    this.appendMessage('user', text);
    this.messages.push({ role: 'user', content: text });
    // Also append to the Anthropic history so the API receives the new user
    // message as part of the full context — without this, history ends with
    // the previous assistant turn and the model has nothing new to respond to.
    this.history.push({ role: 'user', content: text });
    this.setThinking(true);

    try {
      const apiBase = this.config.apiBaseUrl ?? 'https://app.coloredkidz.gr';
      const response = await fetch(
        `${apiBase}/api/v1/agent/${this.config.businessSlug}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: this.messages,
            // Round-trip the full Anthropic history so the agent remembers
            // tool results from previous turns — without this it forgets
            // every staff/service lookup on the next message.
            ...(this.history.length > 0 ? { history: this.history } : {}),
          }),
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as { reply: string; messages: AgentMessage[]; history: unknown[] };

      this.messages = data.messages;
      this.history  = data.history ?? [];
      this.appendMessage('assistant', data.reply);

    } catch {
      this.appendMessage('assistant', this.strings.error);
    } finally {
      this.setThinking(false);
    }
  }

  private appendMessage(role: 'user' | 'assistant', content: string): void {
    if (!this.messagesEl) return;

    const msg = document.createElement('div');
    msg.className = `swc-message swc-message--${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'swc-bubble';
    bubble.innerHTML = renderMarkdown(content);

    msg.appendChild(bubble);
    this.messagesEl.appendChild(msg);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private setThinking(thinking: boolean): void {
    this.isThinking = thinking;
    if (this.inputEl) this.inputEl.disabled = thinking;
    if (this.sendBtn) this.sendBtn.disabled  = thinking;

    const existing = this.root.querySelector('.swc-thinking');

    if (thinking && !existing && this.messagesEl) {
      const indicator = document.createElement('div');
      indicator.className = 'swc-message swc-message--assistant swc-thinking';
      indicator.innerHTML = `<div class="swc-bubble swc-bubble--thinking"><span></span><span></span><span></span></div>`;
      this.messagesEl.appendChild(indicator);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } else if (!thinking && existing) {
      existing.remove();
    }
  }

  private darken(hex: string): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (n >> 16) - 30);
    const g = Math.max(0, ((n >> 8) & 0xff) - 30);
    const b = Math.max(0, (n & 0xff) - 30);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}
