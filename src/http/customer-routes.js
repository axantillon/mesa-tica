import { badRequest, readJson, requireIdentifier, requireObject, sendJson } from './request.js';

export const MAX_QUANTITY = 99;
const MAX_LINES = 50;
const TRACKING_TOKEN = /^[A-Za-z0-9_-]{32}$/;

const LINK_UNAVAILABLE = {
  error: 'link_unavailable',
  message: "We couldn't open this tracking link. Check the full saved link.",
};

/** Validates a reviewed selection: at least one line, known shape, whole quantities 1–99, no duplicates. */
function parseSelection(value) {
  if (!Array.isArray(value) || value.length === 0) throw badRequest('selection must list at least one dish.');
  if (value.length > MAX_LINES) throw badRequest(`selection can list at most ${MAX_LINES} dishes.`);
  const seen = new Set();
  return value.map((line, index) => {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) throw badRequest(`selection[${index}] must be an object.`);
    const { code, quantity, reviewedPrice } = line;
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(code)) throw badRequest(`selection[${index}].code is invalid.`);
    if (seen.has(code)) throw badRequest(`selection lists ${code} more than once.`);
    seen.add(code);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw badRequest(`selection[${index}].quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    if (!Number.isSafeInteger(reviewedPrice) || reviewedPrice < 0) {
      throw badRequest(`selection[${index}].reviewedPrice must be a whole number of colones.`);
    }
    return { code, quantity, reviewedPrice };
  });
}

/** MenuController, OrderController and TrackingController: the guest-facing request boundary. */
export function customerRoutes({ menuService, checkoutService, trackingService, clock }) {
  return [
    {
      method: 'GET',
      path: /^\/api\/menu$/,
      handler: (req, res) => sendJson(res, 200, menuService.getMenu(clock.now())),
    },
    {
      method: 'POST',
      path: /^\/api\/orders$/,
      handler: async (req, res) => {
        const body = requireObject(await readJson(req));
        const context = requireIdentifier(body.context, 'context');
        const attempt = requireIdentifier(body.attempt, 'attempt');
        const selection = parseSelection(body.selection);
        const result = checkoutService.accept(context, attempt, selection);
        if (result.outcome === 'accepted') return sendJson(res, result.created ? 201 : 200, result);
        if (result.outcome === 'rejected') return sendJson(res, 422, result);
        throw new Error('Submission decision was not recorded.');
      },
    },
    {
      method: 'POST',
      path: /^\/api\/orders\/recover$/,
      handler: async (req, res) => {
        const body = requireObject(await readJson(req));
        const context = requireIdentifier(body.context, 'context');
        const attempt = requireIdentifier(body.attempt, 'attempt');
        sendJson(res, 200, checkoutService.recover(context, attempt));
      },
    },
    {
      method: 'GET',
      path: /^\/api\/track\/([^/]*)$/,
      handler: (req, res, [token]) => {
        // Malformed, unknown and guessed links (including bare order numbers) get the same generic reply.
        const snapshot = TRACKING_TOKEN.test(token) ? trackingService.getSnapshot(token) : null;
        if (!snapshot) return sendJson(res, 404, LINK_UNAVAILABLE);
        sendJson(res, 200, snapshot);
      },
    },
  ];
}
