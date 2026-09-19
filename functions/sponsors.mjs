import { createHash, randomBytes } from 'node:crypto';

export class SponsorError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new SponsorError(code, status); };
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_CENTS = 1_000_000;

export function checkoutCents(mode, top, current, requested) {
  if (mode !== 'join' && mode !== 'takeover') fail('INVALID_SPONSOR_MODE');
  const minimum = mode === 'join' ? 100 : Math.max(100, Math.ceil((top + 100 - current) / 100) * 100);
  const cents = requested === undefined ? minimum : requested;
  if (!Number.isSafeInteger(cents) || cents < minimum || cents % 100 !== 0 || cents > MAX_CENTS) fail('INVALID_SPONSOR_AMOUNT');
  return cents;
}

export function sponsorUrl(value) {
  if (typeof value !== 'string' || value.length > 400) fail('INVALID_SPONSOR_URL');
  let url;
  try {
    const text = value.trim();
    url = new URL(/^@[A-Za-z0-9_]{1,15}$/.test(text) ? `https://x.com/${text.slice(1)}` : text.includes('://') ? text : `https://${text}`);
  } catch { fail('INVALID_SPONSOR_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
    || /\.(local|localhost|internal|test|invalid|example)$/.test(url.hostname)) fail('INVALID_SPONSOR_URL');
  url.hash = '';
  return url.href;
}

function parseSubmission(uid, input) {
  if (typeof uid !== 'string' || uid.length < 16 || uid.length > 256) fail('AUTH_REQUIRED', 401);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SPONSOR_INPUT');
  if (typeof input.submissionId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.submissionId)) fail('INVALID_SUBMISSION_ID');
  if (typeof input.name !== 'string' || input.name.length > 120 || /[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(input.name)) fail('INVALID_SPONSOR_NAME');
  const name = input.name.normalize('NFC').trim();
  if (!name || [...name].length > 60) fail('INVALID_SPONSOR_NAME');
  const mode = input.mode ?? 'join';
  // Validate type, whole dollars and cap before any database/provider work.
  checkoutCents(mode, 0, 0, input.amount);
  return { owner: hash(uid), name, url: sponsorUrl(input.url), mode, requested: input.amount ?? null };
}

/** Only pass signature-verified events. Credentials, HTTP limits and cookie authority belong to the wrapper. */
export function createSponsorService({ db, stripe, origin, allowedReturnOrigins = [origin], livemode = true, now = Date.now, getPuzzle }) {
  const site = new URL(origin);
  if (site.protocol !== 'https:' || site.username || site.password) fail('INVALID_CHECKOUT_ORIGIN', 503);
  const returnOrigins = new Set(allowedReturnOrigins);
  for (const value of returnOrigins) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || value !== url.origin) fail('INVALID_CHECKOUT_ORIGIN', 503);
  }
  if (!returnOrigins.has(site.origin)) fail('INVALID_CHECKOUT_ORIGIN', 503);
  if (typeof livemode !== 'boolean') fail('INVALID_STRIPE_MODE', 503);
  const prefix = livemode ? 'sponsorsLive' : 'sponsorsTest';
  const submissions = `${prefix}Submissions`;
  const charges = `${prefix}Charges`;
  const listings = db.collection(prefix);

  return {
    async list() {
      const snapshot = await listings.orderBy('cents', 'desc').get();
      const entries = snapshot.docs.map(doc => doc.data());
      const rows = entries.filter(row => row.cents > 0 && !row.hidden)
        .map(({ name, url, cents }) => ({ name, url, cents }))
        .sort((a, b) => b.cents - a.cents || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
      return { rows, total: rows.length, totalCents: entries.reduce((sum, row) => sum + row.cents, 0), topCents: entries[0]?.cents ?? 0 };
    },

    async checkout(uid, input, requestOrigin = site.origin) {
      if (!returnOrigins.has(requestOrigin)) fail('INVALID_RETURN_ORIGIN', 403);
      const payload = parseSubmission(uid, input);
      if (input.returnTo !== undefined && !['entry', 'result'].includes(input.returnTo)) fail('INVALID_RETURN_CONTEXT');
      if (input.puzzleId !== undefined) {
        if (typeof input.puzzleId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.puzzleId)) fail('INVALID_RETURN_CONTEXT');
        if (typeof getPuzzle !== 'function') fail('RETURN_CONTEXT_UNAVAILABLE', 503);
        // The game authority rejects invalid dates, unpublished puzzles, and future days.
        const puzzle = getPuzzle(input.puzzleId);
        payload.puzzleId = puzzle.id;
        payload.returnTo = input.returnTo ?? 'entry';
      } else if (input.returnTo === 'result') fail('INVALID_RETURN_CONTEXT');
      const id = hash(`${payload.owner}:${input.submissionId}`);
      const fingerprint = hash(JSON.stringify(payload));
      const reference = db.doc(`${submissions}/${id}`);
      const listingRef = db.doc(`${prefix}/${hash(payload.url)}`);
      const submission = await db.runTransaction(async transaction => {
        const existing = await transaction.get(reference);
        if (existing.exists) {
          if (existing.data().fingerprint !== fingerprint) fail('SUBMISSION_CONFLICT', 409);
          return existing.data();
        }
        const [top, current] = await Promise.all([
          transaction.get(listings.orderBy('cents', 'desc').limit(1)), transaction.get(listingRef),
        ]);
        const cents = checkoutCents(payload.mode, top.docs[0]?.data().cents ?? 0, current.exists ? current.data().cents : 0, input.amount);
        const created = { ...payload, cents, fingerprint, createdAt: now(), livemode, returnOrigin: requestOrigin,
          integrationIdentifier: `jumble-sponsor-${[...randomBytes(8)].map(byte => String.fromCharCode(97 + byte % 26)).join('')}` };
        transaction.set(reference, created);
        return created;
      });
      if (submission.checkout) {
        if (submission.checkout.expiresAt <= now()) fail('CHECKOUT_EXPIRED', 409);
        return { url: submission.checkout.url, cents: submission.cents, submissionId: input.submissionId };
      }
      // Stripe may prune idempotency keys after 24 hours. Never recreate an old uncertain checkout.
      if (now() - submission.createdAt > 22 * 60 * 60 * 1000) fail('SUBMISSION_EXPIRED', 409);
      const metadata = { project: 'jumble', kind: 'sponsor', sponsorId: id };
      const returnUrl = status => {
        // Persist the initiating approved origin so retries cannot move a checkout between sites.
        const returnOrigin = submission.returnOrigin ?? site.origin;
        if (!returnOrigins.has(returnOrigin)) fail('INVALID_RETURN_ORIGIN', 403);
        const url = new URL('/', returnOrigin);
        url.searchParams.set('sponsor', status);
        if (submission.puzzleId) {
          url.searchParams.set('day', submission.puzzleId);
          url.searchParams.set('view', submission.returnTo);
        }
        return url.href;
      };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', integration_identifier: submission.integrationIdentifier,
        branding_settings: { display_name: 'Jumble' },
        line_items: [{ price_data: { currency: 'usd', unit_amount: submission.cents,
          product_data: { name: 'Jumble sponsorship', description: 'Your listing appears after payment confirmation. Sponsor rank can change.' } }, quantity: 1 }],
        metadata, payment_intent_data: { metadata },
        success_url: returnUrl('thanks'), cancel_url: returnUrl('cancelled'),
        expires_at: Math.floor(submission.createdAt / 1000) + 23 * 60 * 60,
      }, { idempotencyKey: `jumble:${livemode ? 'live' : 'test'}:sponsor:${id}` });
      if (session.livemode !== livemode || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')
        || !Number.isSafeInteger(session.expires_at)) fail('INVALID_CHECKOUT_SESSION', 503);
      await db.runTransaction(async transaction => {
        const saved = (await transaction.get(reference)).data();
        if (saved.checkout && saved.checkout.id !== session.id) fail('CHECKOUT_CONFLICT', 409);
        transaction.set(reference, { ...saved, checkout: { id: session.id, url: session.url, expiresAt: session.expires_at * 1000 } });
      });
      return { url: session.url, cents: submission.cents, submissionId: input.submissionId };
    },

    async handleEvent(event) {
      if (!event || event.livemode !== livemode) return { received: true, ignored: true };
      let chargeId;
      let lostDispute = false;
      if (['charge.succeeded', 'charge.refunded', 'charge.updated'].includes(event.type)) chargeId = event.data?.object?.id;
      if (event.type === 'charge.dispute.closed') {
        const disputeId = event.data?.object?.id;
        if (typeof disputeId !== 'string' || !/^dp_[A-Za-z0-9]+$/.test(disputeId)) fail('INVALID_DISPUTE', 400);
        const dispute = await stripe.disputes.retrieve(disputeId);
        if (dispute.status !== 'lost') return { received: true, ignored: true };
        chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        lostDispute = true;
      }
      if (!chargeId) return { received: true, ignored: true };
      if (typeof chargeId !== 'string' || !/^ch_[A-Za-z0-9]+$/.test(chargeId)) fail('INVALID_CHARGE', 400);
      // Read current provider state, never the potentially stale webhook snapshot.
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.id !== chargeId || charge.livemode !== livemode || charge.metadata?.project !== 'jumble'
        || charge.metadata.kind !== 'sponsor' || charge.currency !== 'usd' || !charge.paid || !charge.captured) return { received: true, ignored: true };
      const sponsorId = charge.metadata.sponsorId;
      if (typeof sponsorId !== 'string' || !/^[a-f0-9]{64}$/.test(sponsorId)) fail('INVALID_SPONSOR_REFERENCE', 409);
      if (!Number.isSafeInteger(charge.amount) || charge.amount < 100 || charge.amount > MAX_CENTS
        || charge.amount % 100 !== 0 || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0
        || charge.amount_refunded > charge.amount || (charge.amount_captured !== undefined && charge.amount_captured !== charge.amount)) fail('INVALID_CHARGE_AMOUNT', 409);
      const proposed = lostDispute ? 0 : charge.amount - charge.amount_refunded;
      return db.runTransaction(async transaction => {
        const submissionDoc = await transaction.get(db.doc(`${submissions}/${sponsorId}`));
        if (!submissionDoc.exists) fail('SPONSOR_SUBMISSION_MISSING', 503);
        const submission = submissionDoc.data();
        if (submission.cents !== charge.amount || submission.livemode !== livemode) fail('CHARGE_SUBMISSION_MISMATCH', 409);
        const listingRef = db.doc(`${prefix}/${hash(submission.url)}`);
        const chargeRef = db.doc(`${charges}/${chargeId}`);
        const [listingDoc, creditDoc] = await Promise.all([transaction.get(listingRef), transaction.get(chargeRef)]);
        const listing = listingDoc.exists ? listingDoc.data() : { owner: submission.owner, name: submission.name, url: submission.url, cents: 0, hidden: false };
        const previous = creditDoc.exists ? creditDoc.data() : null;
        if (previous && previous.sponsorId !== sponsorId) fail('CHARGE_OWNER_CONFLICT', 409);
        // Deliberately monotonic: appeal reversals require operator reconciliation.
        const cents = previous ? Math.min(previous.cents, proposed) : proposed;
        const balance = listing.cents + cents - (previous?.cents ?? 0);
        if (!Number.isSafeInteger(balance) || balance < 0) fail('INVALID_SPONSOR_BALANCE', 503);
        transaction.set(chargeRef, { sponsorId, cents });
        transaction.set(listingRef, { ...listing, cents: balance });
        return { received: true, creditedCents: cents };
      });
    },
  };
}
