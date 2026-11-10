import { ORDER_STATUSES } from '../db.js';
import { ORDER_FILTERS } from '../stores/order-store.js';
import { HttpError, badRequest, parseCookies, readJson, requireObject, sendJson } from './request.js';

export const SESSION_COOKIE = 'mesa_staff_session';

const SIGN_IN_REQUIRED = new HttpError(401, 'sign_in_required', 'Your staff session has ended. Sign in to continue.');

function sessionCookie(value, maxAgeSeconds, secure) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function parseOrderNumber(text) {
  if (!/^\d{1,9}$/.test(text)) throw badRequest('The order number must be a whole number.');
  return Number(text);
}

/** AuthController and StaffOrderController. Every protected route resolves the session before any data access. */
export function staffRoutes({ accessService, orderService, config }) {
  const tokenOf = (req) => parseCookies(req)[SESSION_COOKIE];

  function requireStaff(req) {
    const employee = accessService.requireStaff(tokenOf(req));
    if (!employee) throw SIGN_IN_REQUIRED;
    return employee;
  }

  return [
    {
      method: 'POST',
      path: /^\/api\/staff\/session$/,
      handler: async (req, res) => {
        const body = requireObject(await readJson(req));
        const { username, password } = body;
        if (typeof username !== 'string' || username.trim() === '' || username.length > 100) {
          throw badRequest('Enter your username.');
        }
        if (typeof password !== 'string' || password === '' || password.length > 200) throw badRequest('Enter your password.');

        const outcome = await accessService.signIn({ username, password }, req.socket.remoteAddress);
        if (outcome.result === 'limited') {
          return sendJson(
            res,
            429,
            { error: 'sign_in_limited', message: 'Too many sign-in attempts. Wait a few minutes, then try again.' },
            { 'Retry-After': String(outcome.retryAfterSeconds) },
          );
        }
        if (outcome.result === 'failed') {
          return sendJson(res, 401, { error: 'sign_in_failed', message: "We couldn't sign you in. Check your credentials and try again." });
        }
        sendJson(
          res,
          200,
          { employee: { displayName: outcome.employee.displayName } },
          { 'Set-Cookie': sessionCookie(outcome.token, config.sessionTtlMinutes * 60, config.secureCookies) },
        );
      },
    },
    {
      method: 'GET',
      path: /^\/api\/staff\/session$/,
      handler: (req, res) => sendJson(res, 200, { employee: { displayName: requireStaff(req).displayName } }),
    },
    {
      method: 'DELETE',
      path: /^\/api\/staff\/session$/,
      handler: (req, res) => {
        accessService.signOut(tokenOf(req));
        sendJson(res, 200, { signedOut: true }, { 'Set-Cookie': sessionCookie('', 0, config.secureCookies) });
      },
    },
    {
      method: 'GET',
      path: /^\/api\/staff\/orders$/,
      handler: (req, res, _params, url) => {
        requireStaff(req);
        const filter = url.searchParams.get('filter') ?? 'Active';
        if (!Object.hasOwn(ORDER_FILTERS, filter)) {
          throw badRequest(`Unknown filter. Use one of: ${Object.keys(ORDER_FILTERS).join(', ')}.`);
        }
        sendJson(res, 200, orderService.listQueue(filter));
      },
    },
    {
      method: 'GET',
      path: /^\/api\/staff\/orders\/([^/]+)$/,
      handler: (req, res, [numberText]) => {
        requireStaff(req);
        const detail = orderService.getDetail(parseOrderNumber(numberText));
        if (!detail) return sendJson(res, 404, { error: 'order_unavailable', message: 'This order is unavailable.' });
        sendJson(res, 200, { order: detail });
      },
    },
    {
      method: 'POST',
      path: /^\/api\/staff\/orders\/([^/]+)\/status$/,
      handler: async (req, res, [numberText]) => {
        const body = requireObject(await readJson(req));
        const employee = requireStaff(req);
        const number = parseOrderNumber(numberText);
        const { revision, target, reason } = body;
        if (!Number.isSafeInteger(revision) || revision < 1) throw badRequest('revision must be the order revision you reviewed.');
        if (!ORDER_STATUSES.includes(target)) throw badRequest(`target must be one of: ${ORDER_STATUSES.join(', ')}.`);
        if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
          throw badRequest('reason must be text of at most 1000 characters.');
        }

        const outcome = orderService.changeStatus(number, revision, target, reason, employee);
        switch (outcome.result) {
          case 'changed':
            return sendJson(res, 200, { result: 'changed', order: outcome.order });
          case 'conflict':
            return sendJson(res, 409, {
              error: 'conflict',
              message: `Order ${number} changed before your update was saved. It is now ${outcome.order.status}. Review the current order before choosing another action.`,
              order: outcome.order,
            });
          case 'invalid':
            return sendJson(res, 422, { error: outcome.correction.code, message: outcome.correction.message, order: outcome.order });
          default:
            return sendJson(res, 404, { error: 'order_unavailable', message: 'This order is unavailable.' });
        }
      },
    },
  ];
}
