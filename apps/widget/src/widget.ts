import { SlotWiseApiClient, ApiError } from './api-client';
import type { ApiService, ApiSlot, ApiBusiness } from './api-client';
import widgetStyles from './styles.css?inline';

type Step = 'service' | 'slot' | 'details' | 'confirm';

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
  loading: boolean;
  error: string | null;
  bookingRef: string | null;
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

  constructor(config: SlotWiseWidgetConfig) {
    const apiBaseUrl = config.apiBaseUrl ?? 'https://app.coloredkidz.gr';
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
      loading: false,
      error: null,
      bookingRef: null,
    };

    this.render();
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
      this.setState({ business, services, loading: false });
    } catch (err) {
      this.setState({ loading: false, error: this.errorMessage(err) });
    }
  }

  private async loadSlots(): Promise<void> {
    if (!this.state.selectedService) return;
    this.setState({ loading: true, error: null, slots: [] });
    try {
      const slots = await this.api.getSlots(this.state.selectedService.id, this.state.selectedDate);
      this.setState({ slots, loading: false });
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
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
      });
      this.setState({ loading: false, step: 'confirm', bookingRef: booking.ref });
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
    this.setState({
      step: 'service',
      selectedService: null,
      selectedSlot: null,
      slots: [],
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      bookingRef: null,
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
      slotsHtml = `<div class="sw-empty">No availability on this day. Try another date.</div>`;
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
    const { selectedService, selectedSlot } = this.state;
    if (!selectedService || !selectedSlot) return '';

    const when = new Date(selectedSlot.startsAt).toLocaleString([], {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    return `
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

      <div class="sw-field">
        <label for="sw-name">Full name</label>
        <input id="sw-name" type="text" data-field="customerName" value="${escapeHtml(this.state.customerName)}" autocomplete="name" />
      </div>
      <div class="sw-field">
        <label for="sw-phone">Phone number</label>
        <input id="sw-phone" type="tel" data-field="customerPhone" value="${escapeHtml(this.state.customerPhone)}" autocomplete="tel" />
      </div>
      <div class="sw-field">
        <label for="sw-email">Email (optional)</label>
        <input id="sw-email" type="email" data-field="customerEmail" value="${escapeHtml(this.state.customerEmail)}" autocomplete="email" />
      </div>

      <button class="sw-button" data-action="submit-booking" ${this.canSubmit() ? '' : 'disabled'}>
        ${this.state.loading ? '<span class="sw-spinner"></span>' : 'Confirm booking'}
      </button>
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

  private canSubmit(): boolean {
    return (
      this.state.customerName.trim().length > 0 &&
      this.state.customerPhone.trim().length >= 6 &&
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
        }
      });
    });

    container.querySelectorAll('input[data-field]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const field = (e.target as HTMLInputElement).dataset.field as keyof Pick<WidgetState, 'customerName' | 'customerPhone' | 'customerEmail'>;
        const value = (e.target as HTMLInputElement).value;
        this.state = { ...this.state, [field]: value };
        // Don't full re-render on every keystroke (would steal input focus) —
        // just update the submit button's disabled state directly.
        const submitBtn = container.querySelector('[data-action="submit-booking"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = !this.canSubmit();
      });
    });
  }
}
