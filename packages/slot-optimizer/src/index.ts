import type { Slot, Booking, ScoreReason } from '@slotwise/types';

// ─── Config ───────────────────────────────────────────────────────────────────

interface OptimizerConfig {
  adjacencyBonus: number;       // reward for slot next to existing booking
  gapPenalty: number;           // penalty for creating gap < minGapMinutes
  minGapMinutes: number;        // gaps smaller than this are "orphan" gaps
  endOfDayPenalty: number;      // discourage pushing work to extremes
  staffContinuityBonus: number; // same staff working back-to-back
  fragmentationPenalty: number; // penalise swiss-cheese calendars
}

const DEFAULT_CONFIG: OptimizerConfig = {
  adjacencyBonus: 25,
  gapPenalty: 30,
  minGapMinutes: 30,
  endOfDayPenalty: 10,
  staffContinuityBonus: 15,
  fragmentationPenalty: 20,
};

// ─── Core scorer ─────────────────────────────────────────────────────────────

export function scoreSlot(
  candidate: Pick<Slot, 'startsAt' | 'endsAt' | 'staffId'>,
  existingBookings: Booking[],
  config: Partial<OptimizerConfig> = {}
): { score: number; reasons: ScoreReason[] } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: ScoreReason[] = [];
  let score = 50; // baseline

  const staffBookings = existingBookings.filter(
    (b) => b.staffId === candidate.staffId && b.status !== 'cancelled'
  );

  const candidateStart = candidate.startsAt.getTime();
  const candidateEnd = candidate.endsAt.getTime();

  // ── Adjacency bonus ──────────────────────────────────────────────────────
  const isAdjacentBefore = staffBookings.some(
    (b) => Math.abs(b.endsAt.getTime() - candidateStart) < 60_000 // within 1 min
  );
  const isAdjacentAfter = staffBookings.some(
    (b) => Math.abs(b.startsAt.getTime() - candidateEnd) < 60_000
  );

  if (isAdjacentBefore || isAdjacentAfter) {
    score += cfg.adjacencyBonus;
    reasons.push({
      factor: 'adjacency',
      delta: cfg.adjacencyBonus,
      label: 'Fills a gap next to existing booking',
    });
  }

  // ── Orphan gap penalty ───────────────────────────────────────────────────
  // Would this slot create a tiny unusable gap before or after it?
  const gapBefore = staffBookings
    .filter((b) => b.endsAt.getTime() < candidateStart)
    .reduce((closest, b) => {
      const gap = candidateStart - b.endsAt.getTime();
      return gap < closest ? gap : closest;
    }, Infinity);

  const gapAfter = staffBookings
    .filter((b) => b.startsAt.getTime() > candidateEnd)
    .reduce((closest, b) => {
      const gap = b.startsAt.getTime() - candidateEnd;
      return gap < closest ? gap : closest;
    }, Infinity);

  const minGapMs = cfg.minGapMinutes * 60_000;

  if (gapBefore !== Infinity && gapBefore < minGapMs && gapBefore > 0) {
    score -= cfg.gapPenalty;
    reasons.push({
      factor: 'gap_penalty',
      delta: -cfg.gapPenalty,
      label: `Creates a ${Math.round(gapBefore / 60_000)}min unusable gap before`,
    });
  }

  if (gapAfter !== Infinity && gapAfter < minGapMs && gapAfter > 0) {
    score -= cfg.gapPenalty;
    reasons.push({
      factor: 'gap_penalty',
      delta: -cfg.gapPenalty,
      label: `Creates a ${Math.round(gapAfter / 60_000)}min unusable gap after`,
    });
  }

  // ── End of day penalty ───────────────────────────────────────────────────
  const hour = candidate.startsAt.getHours();
  if (hour < 9 || hour >= 17) {
    score -= cfg.endOfDayPenalty;
    reasons.push({
      factor: 'end_of_day',
      delta: -cfg.endOfDayPenalty,
      label: 'Outside core hours',
    });
  }

  // ── Fragmentation score ──────────────────────────────────────────────────
  // Count isolated single bookings (no neighbours within 90 min)
  const isolatedCount = staffBookings.filter((b) => {
    const hasNeighbour = staffBookings.some(
      (other) =>
        other.id !== b.id &&
        Math.abs(other.startsAt.getTime() - b.endsAt.getTime()) < 90 * 60_000
    );
    return !hasNeighbour;
  }).length;

  if (isolatedCount > 2) {
    const penalty = cfg.fragmentationPenalty * (isolatedCount - 2);
    score -= penalty;
    reasons.push({
      factor: 'fragmentation',
      delta: -penalty,
      label: `Calendar has ${isolatedCount} isolated slots`,
    });
  }

  // ── Staff continuity ─────────────────────────────────────────────────────
  const hasBackToBack =
    staffBookings.length > 0 && (isAdjacentBefore || isAdjacentAfter);
  if (hasBackToBack) {
    score += cfg.staffContinuityBonus;
    reasons.push({
      factor: 'staff_continuity',
      delta: cfg.staffContinuityBonus,
      label: 'Keeps staff working continuously',
    });
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ─── Rank & filter slots ──────────────────────────────────────────────────────

export function rankSlots(
  candidates: Array<Pick<Slot, 'startsAt' | 'endsAt' | 'staffId' | 'staffName'>>,
  existingBookings: Booking[],
  config?: Partial<OptimizerConfig>
): Slot[] {
  return candidates
    .map((candidate) => {
      const { score, reasons } = scoreSlot(candidate, existingBookings, config);
      return { ...candidate, score, scoreReasons: reasons };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Cancellation recovery ────────────────────────────────────────────────────

export interface ConsolidationSuggestion {
  bookingId: string;
  currentSlot: Date;
  suggestedSlot: Date;
  scoreGain: number;
  incentive?: string;
}

/**
 * When a booking is cancelled, find existing bookings that could shift
 * to consolidate the day and eliminate orphan gaps.
 */
export function findConsolidationOpportunities(
  cancelledSlot: { startsAt: Date; endsAt: Date; staffId: string },
  remainingBookings: Booking[],
  config?: Partial<OptimizerConfig>
): ConsolidationSuggestion[] {
  const suggestions: ConsolidationSuggestion[] = [];
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const gapDuration = cancelledSlot.endsAt.getTime() - cancelledSlot.startsAt.getTime();

  for (const booking of remainingBookings) {
    if (booking.staffId !== cancelledSlot.staffId) continue;

    // Could this booking move into the freed slot?
    const bookingDuration = booking.endsAt.getTime() - booking.startsAt.getTime();
    if (bookingDuration > gapDuration) continue;

    const currentScore = scoreSlot(booking, remainingBookings, config).score;

    // Simulate moving the booking to the freed slot
    const simulatedBooking = {
      ...booking,
      startsAt: cancelledSlot.startsAt,
      endsAt: new Date(cancelledSlot.startsAt.getTime() + bookingDuration),
    };
    const bookingsWithoutThis = remainingBookings.filter((b) => b.id !== booking.id);
    const newScore = scoreSlot(simulatedBooking, bookingsWithoutThis, config).score;

    const scoreGain = newScore - currentScore;
    if (scoreGain >= 10) {
      suggestions.push({
        bookingId: booking.id,
        currentSlot: booking.startsAt,
        suggestedSlot: cancelledSlot.startsAt,
        scoreGain,
        incentive: scoreGain >= 20 ? '10% discount on next visit' : undefined,
      });
    }
  }

  return suggestions.sort((a, b) => b.scoreGain - a.scoreGain);
}

// ─── No-show risk scorer ──────────────────────────────────────────────────────

export interface NoShowFactors {
  daysSinceBooked: number;
  pastNoShows: number;
  totalBookings: number;
  channel: 'widget' | 'agent' | 'whatsapp' | 'admin' | 'api';
  hourOfDay: number;
  dayOfWeek: number;
}

export function scoreNoShowRisk(factors: NoShowFactors): number {
  let risk = 0.1; // baseline 10%

  // History-based
  if (factors.totalBookings > 0) {
    risk += (factors.pastNoShows / factors.totalBookings) * 0.5;
  }

  // Recency of booking (booked far in advance = higher risk)
  if (factors.daysSinceBooked > 14) risk += 0.15;
  else if (factors.daysSinceBooked > 7) risk += 0.08;

  // Channel (walk-in / agent bookings slightly higher risk)
  if (factors.channel === 'agent' || factors.channel === 'whatsapp') risk += 0.05;

  // Time of day (early morning / late evening)
  if (factors.hourOfDay < 9 || factors.hourOfDay >= 18) risk += 0.08;

  // Monday and Friday (common skip days)
  if (factors.dayOfWeek === 1 || factors.dayOfWeek === 5) risk += 0.05;

  return Math.min(0.95, risk);
}
