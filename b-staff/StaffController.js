// B · StaffController: sign-in, queue, order details, status-order rule. Server-side only.
import { STATUSES, verifyPassword } from '../shared/stores.js';

const NEXT = { Received: 'Preparing', Preparing: 'Ready', Ready: 'Collected' };
const DEFAULT_FILTER = ['Received', 'Preparing', 'Ready'];
const MAX_REASON = 500;
const NOT_SIGNED_IN = { status: 401, body: { reason: 'not_signed_in' } };
const NOT_FOUND = { status: 404, body: { reason: 'not_found' } };

// What staff see. Never the submissionId or the trackingToken.
const summary = (o) => ({
  number: o.number, submittedAt: o.submittedAt, status: o.status, version: o.version, total: o.total, lines: o.lines,
});
const details = (o) => ({ ...summary(o), cancellationReason: o.cancellationReason, statusChanges: o.statusChanges });
const orderNumber = (number) => (/^\d{1,15}$/.test(String(number)) ? Number(number) : null);

export class StaffController {
  // sessionId comes from the HttpOnly cookie of the request this controller serves.
  constructor(orderStore, staffStore, sessionId) {
    this.orderStore = orderStore;
    this.staffStore = staffStore;
    this.sessionId = sessionId;
  }

  signIn(username, password) {
    const employee = typeof username === 'string' ? this.staffStore.findEmployee(username) : undefined;
    const ok = verifyPassword(typeof password === 'string' ? password : '', employee?.passwordHash);
    if (!employee || !ok) return { status: 401, body: { reason: 'bad_credentials' } };
    const session = this.staffStore.createSession(employee.id);
    return { status: 200, body: { name: employee.name }, session };
  }

  listOrders(statusFilter) {
    if (!this.staffStore.findSession(this.sessionId)) return NOT_SIGNED_IN;
    const filter = statusFilter ? statusFilter.split(',') : DEFAULT_FILTER;
    if (!filter.every((s) => STATUSES.includes(s))) return { status: 422, body: { reason: 'bad_filter' } };
    return { status: 200, body: { orders: this.orderStore.listOrders(filter).map(summary) } };
  }

  getOrder(number) {
    if (!this.staffStore.findSession(this.sessionId)) return NOT_SIGNED_IN;
    const n = orderNumber(number);
    const order = n && this.orderStore.getOrder(n);
    return order ? { status: 200, body: { order: details(order) } } : NOT_FOUND;
  }

  changeStatus(number, version, to, reason) {
    const employee = this.staffStore.findSession(this.sessionId);
    if (!employee) return NOT_SIGNED_IN;
    const n = orderNumber(number);
    if (!n) return NOT_FOUND;
    return this.orderStore.transaction(() => {
      const order = this.orderStore.getOrder(n);
      if (!order) return NOT_FOUND;
      if (order.version !== version) return { status: 409, body: { reason: 'stale_version', order: details(order) } };
      const refusal = this.canChange(order.status, to, reason);
      if (refusal) return { status: 422, body: { reason: refusal, order: details(order) } };
      const saved = this.orderStore.saveStatus(n, to, to === 'Cancelled' ? reason.trim() : null, employee);
      return { status: 200, body: { order: details(saved) } };
    });
  }

  // Received → Preparing → Ready → Collected; Cancel with a reason from any of the first three.
  canChange(from, to, reason) {
    if (!STATUSES.includes(to)) return 'unknown_status';
    if (!NEXT[from]) return 'final_status';
    if (to === 'Cancelled') {
      if (typeof reason !== 'string' || !reason.trim()) return 'reason_required';
      return reason.length > MAX_REASON ? 'reason_too_long' : null;
    }
    return NEXT[from] === to ? null : 'not_next_status';
  }
}
