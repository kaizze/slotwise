import dayjs from 'dayjs';
import 'dayjs/locale/el';

interface BookingContext {
  customerName: string;
  serviceName: string;
  staffName: string;
  businessName: string;
  startsAt: Date;
  ref: string;
  locale?: string;
}

function formatDateTime(date: Date, locale = 'en'): string {
  const d = dayjs(date).locale(locale === 'el' ? 'el' : 'en');
  return d.format('dddd D MMMM, HH:mm');
}

// ─── SMS templates (short, no formatting) ─────────────────────────────────────

export const smsTemplates = {
  confirmation(ctx: BookingContext): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Το ραντεβού σου για ${ctx.serviceName} επιβεβαιώθηκε για ${when} με ${ctx.staffName}. Κωδ: ${ctx.ref}`;
    }
    return `${ctx.businessName}: Your ${ctx.serviceName} appointment is confirmed for ${when} with ${ctx.staffName}. Ref: ${ctx.ref}`;
  },

  reminder(ctx: BookingContext): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `Υπενθύμιση: Ραντεβού ${ctx.serviceName} στις ${when} (${ctx.businessName}). Απάντησε CANCEL για ακύρωση.`;
    }
    return `Reminder: ${ctx.serviceName} appointment at ${when} (${ctx.businessName}). Reply CANCEL to cancel.`;
  },

  cancellation(ctx: BookingContext): string {
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Το ραντεβού σου (${ctx.ref}) ακυρώθηκε.`;
    }
    return `${ctx.businessName}: Your appointment (${ctx.ref}) has been cancelled.`;
  },

  rebookOffer(ctx: BookingContext & { newTime: Date; incentive?: string }): string {
    const newWhen = formatDateTime(ctx.newTime, ctx.locale);
    const incentiveText = ctx.incentive ? ` ${ctx.incentive}` : '';
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Άνοιξε θέση στις ${newWhen}. Θες να μετακινήσουμε το ραντεβού σου εκεί?${incentiveText} Απάντησε ΝΑΙ.`;
    }
    return `${ctx.businessName}: A slot opened at ${newWhen}. Want to move your appointment there?${incentiveText} Reply YES.`;
  },

  waitlistOffer(ctx: { businessName: string; serviceName: string; startsAt: Date; locale?: string }): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Άνοιξε θέση για ${ctx.serviceName} στις ${when}. Απάντησε ΝΑΙ για να κλείσεις.`;
    }
    return `${ctx.businessName}: A slot just opened for ${ctx.serviceName} at ${when}. Reply YES to book it.`;
  },
};

// ─── Email templates (basic HTML) ─────────────────────────────────────────────

export const emailTemplates = {
  confirmation(ctx: BookingContext): { subject: string; html: string } {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    const subject =
      ctx.locale === 'el'
        ? `Επιβεβαίωση ραντεβού — ${ctx.businessName}`
        : `Appointment confirmed — ${ctx.businessName}`;

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1f2937;">${ctx.businessName}</h2>
        <p>Hi ${ctx.customerName},</p>
        <p>Your appointment is confirmed:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0;"><strong>${ctx.serviceName}</strong></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">With</td><td style="padding: 8px 0;">${ctx.staffName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">When</td><td style="padding: 8px 0;">${when}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Reference</td><td style="padding: 8px 0;">${ctx.ref}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 13px;">If you need to cancel or reschedule, just reply to this email or contact us directly.</p>
      </div>
    `;

    return { subject, html };
  },
};
