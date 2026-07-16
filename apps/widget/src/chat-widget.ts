import chatStyles from './chat-styles.css?inline';
import { SlotWiseApiClient, ApiError } from './api-client';
import type { ApiCustomer } from './api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

type AuthMode = 'guest' | 'signin' | 'register';

export interface SlotWiseChatConfig {
  businessSlug: string;
  apiBaseUrl?: string;
  accentColor?: string;
  lang?: 'el' | 'en';
  targetId?: string;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

const STRINGS = {
  en: {
    placeholder: 'Type your message...',
    send: 'Send',
    greeting: 'Hi! I can help you book an appointment.\n\nFor example:\n• "I\'d like a haircut this Friday"\n• "What times are available this week?"',
    error: 'Something went wrong. Please try again.',
    poweredBy: 'Powered by SlotWise',
  },
  el: {
    placeholder: 'Γράψτε το μήνυμά σας...',
    send: 'Αποστολή',
    greeting: 'Γεια σας! Μπορώ να σας βοηθήσω να κλείσετε ραντεβού.\n\nΓια παράδειγμα:\n• «Θα ήθελα κούρεμα την Παρασκευή»\n• «Ποιες ώρες έχετε διαθέσιμες αυτή την εβδομάδα;»',
    error: 'Κάτι πήγε στραβά. Παρακαλώ δοκιμάστε ξανά.',
    poweredBy: 'Powered by SlotWise',
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
  private api: SlotWiseApiClient;
  private messages: AgentMessage[] = [];
  // Full agent history including tool calls — opaque to the widget,
  // just stored and sent back so the agent remembers what it already looked up.
  private history: unknown[] = [];
  private root: ShadowRoot;
  private host: HTMLElement;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private accountEl: HTMLElement | null = null;
  private authMode: AuthMode = 'guest';
  private authIdentifier = '';
  private authPassword = '';
  private authName = '';
  private authPhone = '';
  private authEmail = '';
  private signedInCustomer: ApiCustomer | null = null;
  private accessToken: string | null = null;
  private isThinking = false;

  constructor(config: SlotWiseChatConfig) {
    this.config = config;
    this.strings = STRINGS[config.lang ?? 'en'];
    this.api = new SlotWiseApiClient(
      config.apiBaseUrl ?? 'https://app.coloredkidz.gr',
      config.businessSlug,
    );
    this.accessToken = this.readStoredToken();
    if (this.accessToken) this.api.setAccessToken(this.accessToken);

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
    void this.restoreCustomerSession();
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
      <div class="swc-account"></div>
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
    this.accountEl  = panel.querySelector('.swc-account');
    this.inputEl    = panel.querySelector('.swc-input');
    this.sendBtn    = panel.querySelector('.swc-send');
    this.renderAccountArea();

    this.inputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });

    this.sendBtn?.addEventListener('click', () => { void this.handleSend(); });
  }

  private storageKey(): string {
    return `slotwise_customer_token_${this.config.businessSlug}`;
  }

  private readStoredToken(): string | null {
    try {
      return localStorage.getItem(this.storageKey());
    } catch {
      return null;
    }
  }

  private persistToken(token: string | null): void {
    try {
      if (token) localStorage.setItem(this.storageKey(), token);
      else localStorage.removeItem(this.storageKey());
    } catch {
      // ignore blocked storage
    }
  }

  private async restoreCustomerSession(): Promise<void> {
    if (!this.accessToken) return;

    try {
      const me = await this.api.getCustomerMe();
      this.signedInCustomer = me.customer;
      this.authName = me.customer.name;
      this.authPhone = me.customer.phone;
      this.authEmail = me.customer.email ?? '';
    } catch {
      this.accessToken = null;
      this.api.setAccessToken(null);
      this.persistToken(null);
      this.signedInCustomer = null;
    } finally {
      this.renderAccountArea();
    }
  }

  private renderAccountArea(): void {
    if (!this.accountEl) return;

    if (this.signedInCustomer) {
      this.accountEl.innerHTML = `
        <div class="swc-account-banner">
          <div>
            <div class="swc-account-title">Signed in</div>
            <div class="swc-account-sub">${escapeHtml(this.signedInCustomer.name)} · ${escapeHtml(this.signedInCustomer.phone)}</div>
          </div>
          <button type="button" class="swc-link-btn" data-action="sign-out">Sign out</button>
        </div>
      `;
    } else {
      const isGuest = this.authMode === 'guest';
      const isSignIn = this.authMode === 'signin';
      const isRegister = this.authMode === 'register';

      this.accountEl.innerHTML = `
        <div class="swc-auth-tabs" role="tablist" aria-label="Assistant account mode">
          <button type="button" class="swc-auth-tab" data-action="set-auth-mode" data-auth-mode="guest" aria-selected="${isGuest}">Guest</button>
          <button type="button" class="swc-auth-tab" data-action="set-auth-mode" data-auth-mode="signin" aria-selected="${isSignIn}">Sign in</button>
          <button type="button" class="swc-auth-tab" data-action="set-auth-mode" data-auth-mode="register" aria-selected="${isRegister}">Create account</button>
        </div>
        ${isGuest ? `
          <div class="swc-auth-copy">Chat as guest, or sign in so the assistant can reuse your saved details.</div>
        ` : ''}
        ${isSignIn ? `
          <div class="swc-auth-form">
            <input class="swc-auth-input" data-field="authIdentifier" value="${escapeHtml(this.authIdentifier)}" placeholder="Email or phone" autocomplete="username" />
            <input class="swc-auth-input" type="password" data-field="authPassword" value="${escapeHtml(this.authPassword)}" placeholder="Password" autocomplete="current-password" />
            <button type="button" class="swc-auth-btn" data-action="submit-signin" ${this.canSignIn() ? '' : 'disabled'}>Sign in</button>
          </div>
        ` : ''}
        ${isRegister ? `
          <div class="swc-auth-form">
            <input class="swc-auth-input" data-field="authName" value="${escapeHtml(this.authName)}" placeholder="Full name" autocomplete="name" />
            <input class="swc-auth-input" data-field="authPhone" value="${escapeHtml(this.authPhone)}" placeholder="Phone number" autocomplete="tel" />
            <input class="swc-auth-input" data-field="authEmail" value="${escapeHtml(this.authEmail)}" placeholder="Email" autocomplete="email" />
            <input class="swc-auth-input" type="password" data-field="authPassword" value="${escapeHtml(this.authPassword)}" placeholder="Password" autocomplete="new-password" />
            <button type="button" class="swc-auth-btn" data-action="submit-register" ${this.canRegister() ? '' : 'disabled'}>Create account</button>
          </div>
        ` : ''}
      `;
    }

    this.accountEl.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.dataset.action;
        if (action === 'set-auth-mode') {
          const mode = el.dataset.authMode as AuthMode | undefined;
          if (mode) {
            this.authMode = mode;
            this.authPassword = '';
            this.renderAccountArea();
          }
        } else if (action === 'submit-signin') {
          void this.submitSignIn();
        } else if (action === 'submit-register') {
          void this.submitRegister();
        } else if (action === 'sign-out') {
          this.clearSession();
        }
      });
    });

    this.accountEl.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
      el.addEventListener('input', () => {
        const field = el.dataset.field;
        if (!field) return;
        (this as unknown as Record<string, string>)[field] = el.value;
        this.updateAuthButtons();
      });
    });
  }

  private updateAuthButtons(): void {
    const signInBtn = this.accountEl?.querySelector('[data-action="submit-signin"]') as HTMLButtonElement | null;
    if (signInBtn) signInBtn.disabled = !this.canSignIn() || this.isThinking;

    const registerBtn = this.accountEl?.querySelector('[data-action="submit-register"]') as HTMLButtonElement | null;
    if (registerBtn) registerBtn.disabled = !this.canRegister() || this.isThinking;
  }

  private canSignIn(): boolean {
    return this.authIdentifier.trim().length > 0 && this.authPassword.length > 0;
  }

  private canRegister(): boolean {
    return (
      this.authName.trim().length > 0 &&
      this.authPhone.trim().length >= 6 &&
      this.authEmail.includes('@') &&
      this.authPassword.length >= 8
    );
  }

  private applySession(customer: ApiCustomer, accessToken: string): void {
    this.signedInCustomer = customer;
    this.accessToken = accessToken;
    this.api.setAccessToken(accessToken);
    this.persistToken(accessToken);
    this.authIdentifier = '';
    this.authPassword = '';
    this.authName = customer.name;
    this.authPhone = customer.phone;
    this.authEmail = customer.email ?? '';
    this.renderAccountArea();
  }

  private clearSession(): void {
    this.signedInCustomer = null;
    this.authMode = 'guest';
    this.accessToken = null;
    this.authPassword = '';
    this.api.setAccessToken(null);
    this.persistToken(null);
    this.renderAccountArea();
  }

  private async submitSignIn(): Promise<void> {
    if (!this.canSignIn()) return;
    this.setThinking(true);
    try {
      const result = await this.api.loginCustomer({
        identifier: this.authIdentifier.trim(),
        password: this.authPassword,
      });
      this.applySession(result.customer, result.accessToken);
      this.appendMessage('assistant', 'Signed in. I can now reuse your saved details in this chat.');
    } catch (err) {
      this.appendMessage('assistant', this.errorMessage(err));
    } finally {
      this.setThinking(false);
    }
  }

  private async submitRegister(): Promise<void> {
    if (!this.canRegister()) return;
    this.setThinking(true);
    try {
      const result = await this.api.registerCustomer({
        name: this.authName.trim(),
        phone: this.authPhone.trim(),
        email: this.authEmail.trim(),
        password: this.authPassword,
      });
      this.applySession(result.customer, result.accessToken);
      this.appendMessage('assistant', 'Your account is ready. I can now reuse your saved details in this chat.');
    } catch (err) {
      this.appendMessage('assistant', this.errorMessage(err));
    } finally {
      this.setThinking(false);
    }
  }

  private async handleSend(): Promise<void> {
    if (this.isThinking || !this.inputEl) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    this.appendMessage('user', text);
    this.messages.push({ role: 'user', content: text });
    this.setThinking(true);

    try {
      const data = await this.api.chatWithAgent({
        messages: this.messages,
        history: this.history,
      });

      this.messages = data.messages;
      this.history  = data.history ?? [];
      this.appendMessage('assistant', data.reply);

    } catch (err) {
      this.appendMessage('assistant', this.errorMessage(err));
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
    this.updateAuthButtons();

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

  private errorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return this.strings.error;
  }

  private darken(hex: string): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (n >> 16) - 30);
    const g = Math.max(0, ((n >> 8) & 0xff) - 30);
    const b = Math.max(0, (n & 0xff) - 30);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}
