import { SlotWiseApiClient, ApiError } from './api-client';
import type { ApiService, ApiSlot, ApiBusiness, ApiCustomer } from './api-client';
import widgetStyles from './styles.css?inline';

type Step = 'service' | 'slot' | 'details' | 'confirm';
type AuthMode = 'guest' | 'signin' | 'register';

interface WidgetState {
  step: Step;
  business: ApiBusiness | null;
  services: ApiService[];
  selectedService: ApiService | null;
  selectedDate: string; // YYYY-MM-DD
  slots: ApiSlot[];
  selectedSlot: ApiSlot | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** Guest (default) keeps today's flow; signin/register add optional accounts. */
  authMode: AuthMode;
  authIdentifier: string;
  authPassword: string;
  signedInCustomer: ApiCustomer | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
  bookingRef: string | null;
  showWaitlistForm: boolean;
  waitlistJoined: boolean;
}

export interface SlotWiseWidgetConfig {
  businessSlug: string;
  apiBaseUrl?: string;
  accentColor?: string;
}

const STEP_ORDER: Step[] = ['service', 'slot', 'details', 'confirm'];

// ─── Icons (inline SVG, no icon font dependency) ──────────────────────────────

const ICON_CALENDAR = `<svg class="sw-icon-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICON_CLOSE = `<svg class="sw-icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export class SlotWiseWidget {
  private api: SlotWiseApiClient;
  private root: ShadowRoot;
  private host: HTMLElement;
  private state: WidgetState;
  private isOpen = false;
  private businessSlug: string;

  constructor(config: SlotWiseWidgetConfig) {
    const apiBaseUrl = config.apiBaseUrl ?? 'https://app.coloredkidz.gr';
    this.businessSlug = config.businessSlug;
    this.api = new SlotWiseApiClient(apiBaseUrl, config.businessSlug);

    this.host = document.createElement('div');
    this.host.setAttribute('id', 'slotwise-widget-host');
    document.body.appendChild(this.host);

    this.root = this.host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = widgetStyles;
    this.root.appendChild(styleEl);

    if (config.accentColor) {
      this.host.style.setProperty('--sw-accent', config.accentColor);
    }

    const savedToken = this.readStoredToken();
    if (savedToken) {
      this.api.setAccessToken(savedToken);
    }

    this.state = {
      step: 'service',
      business: null,
      services: [],
      selectedService: null,
      selectedDate: this.todayIso(),
      slots: [],
      selectedSlot: null,
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      authMode: 'guest',
      authIdentifier: '',
      authPassword: '',
      signedInCustomer: null,
      accessToken: savedToken,
      loading: false,
      error: null,
      bookingRef: null,
      showWaitlistForm: false,
      waitlistJoined: false,
    };

    this.render();
  }

  private storageKey(): string {
    return `slotwise_customer_token_${this.businessSlug}`;
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
      // private browsing / blocked storage — session still works in-memory
    }
  }

  private applyCustomerSession(customer: ApiCustomer, accessToken: string): void {
    this.api.setAccessToken(accessToken);
    this.persistToken(accessToken);
    this.setState({
      signedInCustomer: customer,
      accessToken,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email ?? '',
      authMode: 'guest',
      authPassword: '',
      authIdentifier: '',
      error: null,
    });
  }

  private clearCustomerSession(): void {
    this.api.setAccessToken(null);
    this.persistToken(null);
    this.setState({
      signedInCustomer: null,
      accessToken: null,
      authPassword: '',
      error: null,
    });
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private setState(partial: Partial<WidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.render();
  }

  // ─── Data loading ────────────────────────────────────────────────────────

  private async loadInitial(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const [business, services] = await Promise.all([
        this.api.getBusiness(),
        this.api.getServices(),
      ]);

      let signedInCustomer = this.state.signedInCustomer;
      let customerName = this.state.customerName;
      let customerPhone = this.state.customerPhone;
      let customerEmail = this.state.customerEmail;
      let accessToken = this.state.accessToken;

      if (accessToken && !signedInCustomer) {
        try {
          const me = await this.api.getCustomerMe();
          signedInCustomer = me.customer;
          customerName = me.customer.name;
          customerPhone = me.customer.phone;
          customerEmail = me.customer.email ?? '';
        } catch {
          this.api.setAccessToken(null);
          this.persistToken(null);
          accessToken = null;
        }
      }

      this.setState({
        business,
        services,
        loading: false,
        signedInCustomer,
        customerName,
        customerPhone,
        customerEmail,
        accessToken,
      });
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async loadSlots(): Promise<void> {
    if (!this.state.selectedService) return;
    this.setState({
      loading: true,
      error: null,
      slots: [],
      showWaitlistForm: false,
      waitlistJoined: false,
    });
    try {
      const slots = await this.api.getSlots(this.state.selectedService.id, this.state.selectedDate);
      this.setState({ slots, loading: false });
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async submitWaitlist(): Promise<void> {
    const { selectedService, selectedDate, customerName, customerPhone, customerEmail } = this.state;
    if (!selectedService) return;
    if (customerName.trim().length === 0 || this.phoneDigitCount(customerPhone) < 8) {
      this.setState({ error: 'Name and a valid phone number (8+ digits) are required.' });
      return;
    }

    this.setState({ loading: true, error: null });
    try {
      await this.api.joinWaitlist({
        serviceId: selectedService.id,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        preferredDate: selectedDate,
      });
      this.setState({ loading: false, waitlistJoined: true, showWaitlistForm: false });
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async submitBooking(): Promise<void> {
    const { selectedService, selectedSlot, customerName, customerPhone, customerEmail } = this.state;
    if (!selectedService || !selectedSlot) return;

    this.setState({ loading: true, error: null });
    try {
      const booking = await this.api.createBooking({
        serviceId: selectedService.id,
        staffId: selectedSlot.staffId,
        slotDatetime: selectedSlot.startsAt,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
      });
      this.setState({ loading: false, step: 'confirm', bookingRef: booking.ref });
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async submitSignIn(): Promise<void> {
    const identifier = this.state.authIdentifier.trim();
    const password = this.state.authPassword;
    if (!identifier || !password) {
      this.setState({ error: 'Email/phone and password are required.' });
      return;
    }

    this.setState({ loading: true, error: null });
    try {
      const result = await this.api.loginCustomer({ identifier, password });
      this.setState({ loading: false });
      this.applyCustomerSession(result.customer, result.accessToken);
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async submitRegister(): Promise<void> {
    const name = this.state.customerName.trim();
    const phone = this.state.customerPhone.trim();
    const email = this.state.customerEmail.trim();
    const password = this.state.authPassword;

    if (!name || this.phoneDigitCount(phone) < 8 || !email || password.length < 8) {
      this.setState({ error: 'Name, a valid phone (8+ digits), email, and a password (8+ characters) are required.' });
      return;
    }

    this.setState({ loading: true, error: null });
    try {
      const result = await this.api.registerCustomer({ name, phone, email, password });
      this.setState({ loading: false });
      this.applyCustomerSession(result.customer, result.accessToken);
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private errorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return 'Something went wrong. Please try again.';
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  private toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen && this.state.services.length === 0) {
      this.loadInitial();
    }
    this.render();
  }

  private goBack(): void {
    const idx = STEP_ORDER.indexOf(this.state.step);
    if (idx > 0) {
      this.setState({ step: STEP_ORDER[idx - 1], error: null });
    }
  }

  private selectService(service: ApiService): void {
    this.setState({ selectedService: service, step: 'slot', error: null });
    this.loadSlots();
  }

  private selectDate(dateIso: string): void {
    this.setState({ selectedDate: dateIso });
    this.loadSlots();
  }

  private selectSlot(slot: ApiSlot): void {
    this.setState({ selectedSlot: slot, step: 'details', error: null });
  }

  private resetForNewBooking(): void {
    const signedIn = this.state.signedInCustomer;
    this.setState({
      step: 'service',
      selectedService: null,
      selectedSlot: null,
      slots: [],
      customerName: signedIn?.name ?? '',
      customerPhone: signedIn?.phone ?? '',
      customerEmail: signedIn?.email ?? '',
      authMode: 'guest',
      authIdentifier: '',
      authPassword: '',
      bookingRef: null,
      showWaitlistForm: false,
      waitlistJoined: false,
      error: null,
    });
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  private render(): void {
    let container = this.root.querySelector('.sw-container') as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.className = 'sw-container';
      this.root.appendChild(container);
    }

    container.innerHTML = `
      <div class="sw-panel" data-open="${this.isOpen}" role="dialog" aria-label="Book an appointment">
        ${this.renderHeader()}
        <div class="sw-body">${this.renderBody()}</div>
      </div>
      <button class="sw-launcher" data-open="${this.isOpen}" aria-label="${this.isOpen ? 'Close booking panel' : 'Book an appointment'}">
        ${ICON_CALENDAR}
        ${ICON_CLOSE}
      </button>
    `;

    container.querySelector('.sw-launcher')?.addEventListener('click', () => this.toggle());
    this.attachBodyListeners(container);
  }

  private renderHeader(): string {
    const { business, step } = this.state;
    const stepIdx = STEP_ORDER.indexOf(step);

    return `
      <div class="sw-header">
        <h2>${business ? escapeHtml(business.name) : 'Book an appointment'}</h2>
        <p>${this.stepLabel(step)}</p>
        <div class="sw-progress">
          ${STEP_ORDER.map((s, i) => `
            <div class="sw-progress-dot" data-state="${i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'pending'}"></div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private stepLabel(step: Step): string {
    switch (step) {
      case 'service': return 'Choose a service';
      case 'slot': return 'Pick a time';
      case 'details': return 'Your details';
      case 'confirm': return 'All set';
    }
  }

  private renderBody(): string {
    if (this.state.loading && this.state.step !== 'confirm') {
      return `<div class="sw-loading-row"><span class="sw-spinner" style="color: var(--sw-accent);"></span></div>`;
    }

    const errorHtml = this.state.error
      ? `<div class="sw-error">${escapeHtml(this.state.error)}</div>`
      : '';

    switch (this.state.step) {
      case 'service':
        return errorHtml + this.renderServiceStep();
      case 'slot':
        return this.renderBackButton() + errorHtml + this.renderSlotStep();
      case 'details':
        return this.renderBackButton() + errorHtml + this.renderDetailsStep();
      case 'confirm':
        return this.renderConfirmStep();
    }
  }

  private renderBackButton(): string {
    return `<button class="sw-back" data-action="back">${ICON_BACK} Back</button>`;
  }

  private renderServiceStep(): string {
    if (this.state.services.length === 0 && !this.state.loading) {
      return `<div class="sw-empty">No services available right now.</div>`;
    }

    return this.state.services.map((s) => `
      <button class="sw-service" data-action="select-service" data-service-id="${s.id}">
        <span class="sw-service-dot" style="background:${escapeHtml(s.color)}"></span>
        <span class="sw-service-info">
          <span class="sw-service-name">${escapeHtml(s.name)}</span>
          <span class="sw-service-meta">${s.durationMinutes} min</span>
        </span>
        <span class="sw-service-price">€${s.price.toFixed(0)}</span>
      </button>
    `).join('');
  }

  private renderSlotStep(): string {
    const dates = this.upcomingDates(7);

    const dateStrip = `
      <div class="sw-date-strip">
        ${dates.map((d) => `
          <button class="sw-date-chip" data-action="select-date" data-date="${d.iso}" data-selected="${d.iso === this.state.selectedDate}">
            <span class="sw-date-chip-day">${d.dayLabel}</span>
            <span class="sw-date-chip-num">${d.dayNum}</span>
          </button>
        `).join('')}
      </div>
    `;

    let slotsHtml: string;
    if (this.state.loading) {
      slotsHtml = `<div class="sw-loading-row"><span class="sw-spinner" style="color: var(--sw-accent);"></span></div>`;
    } else if (this.state.slots.length === 0) {
      if (this.state.waitlistJoined) {
        slotsHtml = `
          <div class="sw-empty">
            <div class="sw-empty-title">You're on the waitlist</div>
            <div class="sw-empty-sub">We'll email or message you if a slot opens on this day.</div>
          </div>
        `;
      } else if (this.state.showWaitlistForm) {
        slotsHtml = `
          <div class="sw-waitlist">
            <div class="sw-empty-title">Join the waitlist</div>
            <div class="sw-empty-sub">We'll notify you if something opens on this day.</div>
            <div class="sw-field">
              <label for="sw-wl-name">Full name</label>
              <input id="sw-wl-name" type="text" data-field="customerName" value="${escapeHtml(this.state.customerName)}" autocomplete="name" />
            </div>
            <div class="sw-field">
              <label for="sw-wl-phone">Phone number</label>
              <input id="sw-wl-phone" type="tel" data-field="customerPhone" value="${escapeHtml(this.state.customerPhone)}" autocomplete="tel" />
            </div>
            <div class="sw-field">
              <label for="sw-wl-email">Email (optional)</label>
              <input id="sw-wl-email" type="email" data-field="customerEmail" value="${escapeHtml(this.state.customerEmail)}" autocomplete="email" />
            </div>
            <button class="sw-button" data-action="submit-waitlist" ${this.canSubmit() ? '' : 'disabled'}>
              ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Notify me'}
            </button>
            <button class="sw-button-secondary" data-action="hide-waitlist">Cancel</button>
          </div>
        `;
      } else {
        slotsHtml = `
          <div class="sw-empty">
            <div class="sw-empty-title">No availability on this day</div>
            <div class="sw-empty-sub">Try another date, or join the waitlist.</div>
            <button class="sw-button" data-action="show-waitlist" style="margin-top:14px;">Notify me</button>
          </div>
        `;
      }
    } else {
      slotsHtml = this.state.slots.map((slot) => {
        const time = new Date(slot.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const opacity = Math.max(0.35, Math.min(1, slot.score / 100));
        return `
          <button class="sw-slot" data-action="select-slot" data-slot-start="${slot.startsAt}">
            <span>
              <span class="sw-slot-time">${time}</span>
              <span class="sw-slot-staff">with ${escapeHtml(slot.staffName)}</span>
            </span>
            <span class="sw-slot-quality" style="opacity:${opacity}"></span>
          </button>
        `;
      }).join('');
    }

    return dateStrip + slotsHtml;
  }

  private renderDetailsStep(): string {
    const { selectedService, selectedSlot, signedInCustomer, authMode } = this.state;
    if (!selectedService || !selectedSlot) return '';

    const when = new Date(selectedSlot.startsAt).toLocaleString([], {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    const summary = `
      <div class="sw-summary">
        <div class="sw-summary-row">
          <span class="sw-summary-label">Service</span>
          <span class="sw-summary-value">${escapeHtml(selectedService.name)}</span>
        </div>
        <div class="sw-summary-row">
          <span class="sw-summary-label">When</span>
          <span class="sw-summary-value">${escapeHtml(when)}</span>
        </div>
        <div class="sw-summary-row">
          <span class="sw-summary-label">With</span>
          <span class="sw-summary-value">${escapeHtml(selectedSlot.staffName)}</span>
        </div>
      </div>
    `;

    if (signedInCustomer) {
      return `
        ${summary}
        <div class="sw-auth-banner">
          <span>Signed in as <strong>${escapeHtml(signedInCustomer.name)}</strong></span>
          <button type="button" class="sw-link-btn" data-action="sign-out">Sign out</button>
        </div>
        ${this.renderGuestFields({ phoneReadonly: true, emailRequired: false })}
        <button class="sw-button" data-action="submit-booking" ${this.canSubmit() ? '' : 'disabled'}>
          ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Confirm booking'}
        </button>
      `;
    }

    const tabs = `
      <div class="sw-auth-tabs" role="tablist" aria-label="Booking as">
        <button type="button" class="sw-auth-tab" role="tab" data-action="set-auth-mode" data-auth-mode="guest" aria-selected="${authMode === 'guest'}">Guest</button>
        <button type="button" class="sw-auth-tab" role="tab" data-action="set-auth-mode" data-auth-mode="signin" aria-selected="${authMode === 'signin'}">Sign in</button>
        <button type="button" class="sw-auth-tab" role="tab" data-action="set-auth-mode" data-auth-mode="register" aria-selected="${authMode === 'register'}">Create account</button>
      </div>
    `;

    if (authMode === 'signin') {
      return `
        ${summary}
        ${tabs}
        <p class="sw-auth-hint">Sign in to reuse your details for this salon.</p>
        <div class="sw-field">
          <label for="sw-auth-id">Email or phone</label>
          <input id="sw-auth-id" type="text" data-field="authIdentifier" value="${escapeHtml(this.state.authIdentifier)}" autocomplete="username" />
        </div>
        <div class="sw-field">
          <label for="sw-auth-password">Password</label>
          <input id="sw-auth-password" type="password" data-field="authPassword" value="${escapeHtml(this.state.authPassword)}" autocomplete="current-password" />
        </div>
        <button class="sw-button" data-action="submit-signin" ${this.canSignIn() ? '' : 'disabled'}>
          ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Sign in'}
        </button>
      `;
    }

    if (authMode === 'register') {
      return `
        ${summary}
        ${tabs}
        <p class="sw-auth-hint">Create an account to save your details for next time. Guest booking stays available.</p>
        ${this.renderGuestFields({ phoneReadonly: false, emailRequired: true })}
        <div class="sw-field">
          <label for="sw-auth-password">Password</label>
          <input id="sw-auth-password" type="password" data-field="authPassword" value="${escapeHtml(this.state.authPassword)}" autocomplete="new-password" />
        </div>
        <button class="sw-button" data-action="submit-register" ${this.canRegister() ? '' : 'disabled'}>
          ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Create account'}
        </button>
      `;
    }

    // Default: guest booking (unchanged fields + confirm)
    return `
      ${summary}
      ${tabs}
      <p class="sw-auth-hint">Book as a guest — no account needed.</p>
      ${this.renderGuestFields({ phoneReadonly: false, emailRequired: false })}
      <button class="sw-button" data-action="submit-booking" ${this.canSubmit() ? '' : 'disabled'}>
        ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Confirm booking'}
      </button>
    `;
  }

  private renderGuestFields(opts: { phoneReadonly: boolean; emailRequired: boolean }): string {
    return `
      <div class="sw-field">
        <label for="sw-name">Full name *</label>
        <input id="sw-name" type="text" data-field="customerName" value="${escapeHtml(this.state.customerName)}" autocomplete="name" />
      </div>
      <div class="sw-field">
        <label for="sw-phone">Phone number *</label>
        <input id="sw-phone" type="tel" data-field="customerPhone" value="${escapeHtml(this.state.customerPhone)}" inputmode="tel" autocomplete="tel" ${opts.phoneReadonly ? 'readonly' : ''} />
      </div>
      <div class="sw-field">
        <label for="sw-email">Email${opts.emailRequired ? ' *' : ' (optional)'}</label>
        <input id="sw-email" type="email" data-field="customerEmail" value="${escapeHtml(this.state.customerEmail)}" autocomplete="email" />
      </div>
    `;
  }

  private renderConfirmStep(): string {
    return `
      <div class="sw-confirm-icon">${ICON_CHECK}</div>
      <div class="sw-confirm-title">Booking confirmed</div>
      <div class="sw-confirm-ref">Reference: ${escapeHtml(this.state.bookingRef ?? '')}</div>
      <button class="sw-button" data-action="new-booking">Book another</button>
    `;
  }

  private phoneDigitCount(phone: string): number {
    return (phone.match(/\d/g) ?? []).length;
  }

  private canSubmit(): boolean {
    return (
      this.state.customerName.trim().length > 0 &&
      this.phoneDigitCount(this.state.customerPhone) >= 8 &&
      !this.state.loading
    );
  }

  private canSignIn(): boolean {
    return (
      this.state.authIdentifier.trim().length > 0 &&
      this.state.authPassword.length > 0 &&
      !this.state.loading
    );
  }

  private canRegister(): boolean {
    return (
      this.state.customerName.trim().length > 0 &&
      this.phoneDigitCount(this.state.customerPhone) >= 8 &&
      this.state.customerEmail.trim().includes('@') &&
      this.state.authPassword.length >= 8 &&
      !this.state.loading
    );
  }

  private upcomingDates(count: number): Array<{ iso: string; dayLabel: string; dayNum: string }> {
    const result: Array<{ iso: string; dayLabel: string; dayNum: string }> = [];
    const today = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push({
        iso: d.toISOString().slice(0, 10),
        dayLabel: d.toLocaleDateString([], { weekday: 'short' }),
        dayNum: String(d.getDate()),
      });
    }
    return result;
  }

  // ─── Event delegation ──────────────────────────────────────────────────────

  private attachBodyListeners(container: HTMLElement): void {
    container.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;

        switch (action) {
          case 'back':
            this.goBack();
            break;
          case 'select-service': {
            const id = (e.currentTarget as HTMLElement).dataset.serviceId;
            const service = this.state.services.find((s) => s.id === id);
            if (service) this.selectService(service);
            break;
          }
          case 'select-date': {
            const date = (e.currentTarget as HTMLElement).dataset.date;
            if (date) this.selectDate(date);
            break;
          }
          case 'select-slot': {
            const start = (e.currentTarget as HTMLElement).dataset.slotStart;
            const slot = this.state.slots.find((s) => s.startsAt === start);
            if (slot) this.selectSlot(slot);
            break;
          }
          case 'submit-booking':
            this.submitBooking();
            break;
          case 'new-booking':
            this.resetForNewBooking();
            break;
          case 'show-waitlist':
            this.setState({ showWaitlistForm: true, error: null });
            break;
          case 'hide-waitlist':
            this.setState({ showWaitlistForm: false, error: null });
            break;
          case 'submit-waitlist':
            this.submitWaitlist();
            break;
          case 'set-auth-mode': {
            const mode = (e.currentTarget as HTMLElement).dataset.authMode as AuthMode | undefined;
            if (mode) {
              this.setState({ authMode: mode, authPassword: '', error: null });
            }
            break;
          }
          case 'submit-signin':
            this.submitSignIn();
            break;
          case 'submit-register':
            this.submitRegister();
            break;
          case 'sign-out':
            this.clearCustomerSession();
            break;
        }
      });
    });

    container.querySelectorAll('input[data-field]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const field = (e.target as HTMLInputElement).dataset.field as
          | 'customerName'
          | 'customerPhone'
          | 'customerEmail'
          | 'authIdentifier'
          | 'authPassword';
        const value = (e.target as HTMLInputElement).value;
        this.state = { ...this.state, [field]: value };
        // Don't full re-render on every keystroke (would steal input focus) —
        // just update the submit button's disabled state directly.
        const bookingBtn = container.querySelector(
          '[data-action="submit-booking"], [data-action="submit-waitlist"]',
        ) as HTMLButtonElement | null;
        if (bookingBtn) bookingBtn.disabled = !this.canSubmit();

        const signInBtn = container.querySelector('[data-action="submit-signin"]') as HTMLButtonElement | null;
        if (signInBtn) signInBtn.disabled = !this.canSignIn();

        const registerBtn = container.querySelector('[data-action="submit-register"]') as HTMLButtonElement | null;
        if (registerBtn) registerBtn.disabled = !this.canRegister();
      });
    });
  }
}
