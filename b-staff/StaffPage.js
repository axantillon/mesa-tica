// B · StaffPage: sign in and the live queue (B1), one order (B2), status changes with conflict handling (B3).
import { Poller, finalError } from '../shared/Poller.js';
import { money, clockTime, dateTime, h, fill, api } from '../shared/ui.js';

const STATUSES = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
const NEXT = { Received: 'Preparing', Preparing: 'Ready', Ready: 'Collected' };
const REFUSALS = {
  reason_required: 'Write a reason before cancelling. The customer will see it.',
  reason_too_long: 'The reason is too long. Keep it under 500 characters.',
  final_status: 'This order is finished (Collected or Cancelled) and cannot change.',
  not_next_status: 'That status is not the next step for this order.',
  unknown_status: 'Unknown status.',
};
const $ = (id) => document.getElementById(id);

class StaffPage {
  constructor() {
    this.filter = new Set(['Received', 'Preparing', 'Ready']); // kept across refreshes
    this.poller = null;
    this.detail = null; // the order as Luis sees it; its version is what a change sends
    this.detailChanged = false;
    this.detailMessage = null;
    this.reasonDraft = '';
    this.busy = false;
  }

  init() {
    $('sign-in').addEventListener('submit', (e) => {
      e.preventDefault();
      this.signIn(new FormData(e.target));
    });
    $('filter').append(
      ...STATUSES.map((s) =>
        h('label', {}, h('input', { type: 'checkbox', checked: this.filter.has(s), onchange: (e) => this.toggle(s, e.target) }), ` ${s}`),
      ),
    );
    this.startQueue(); // no valid session: the first poll gets 401 and shows sign-in
  }

  showSignIn(message = '') {
    this.poller?.stop();
    $('queue-view').hidden = true;
    $('sign-in').hidden = false;
    $('sign-in-message').textContent = message;
    $('who').textContent = '';
  }

  async signIn(form) {
    let result;
    try {
      result = await api('/api/staff/sign-in', { method: 'POST', body: { username: form.get('username'), password: form.get('password') } });
    } catch {
      return this.showSignIn('Could not reach the server. Check the connection and try again.');
    }
    if (result.status !== 200) return this.showSignIn('Wrong username or password.');
    $('sign-in').reset();
    sessionStorage.setItem('mesaTica.staffName', result.body.name);
    this.startQueue();
  }

  startQueue() {
    this.poller?.stop();
    const poller = new Poller(async (signal) => {
      const { status, body } = await api(`/api/staff/orders?status=${[...this.filter].join(',')}`, { signal });
      if (status === 401) throw finalError(401);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      return body.orders;
    });
    this.poller = poller;
    poller.start((p) => p === this.poller && this.renderQueue(p));
  }

  toggle(status, box) {
    if (box.checked) this.filter.add(status);
    else if (this.filter.size > 1) this.filter.delete(status);
    else box.checked = true; // keep at least one status
    this.poller?.kick();
  }

  renderQueue(p) {
    if (p.stopReason?.status === 401) return this.showSignIn(this.signedIn ? 'Your session ended. Please sign in again.' : '');
    this.signedIn = true;
    $('sign-in').hidden = true;
    $('queue-view').hidden = false;
    const name = sessionStorage.getItem('mesaTica.staffName');
    $('who').textContent = name ? `Signed in as ${name}` : 'Signed in';

    const refresh = $('refresh');
    refresh.className = `banner ${p.warning ? 'warn' : 'ok'}`;
    refresh.textContent = p.warning
      ? `Connection problem: this queue may be out of date (last refresh ${p.lastSuccess ? clockTime(p.lastSuccess) : 'never'}). Retrying…`
      : `Last refresh ${clockTime(p.lastSuccess)}. Updates every 2 seconds.`;
    if (!p.data) return;

    const orders = p.data;
    fill($('queue'),
      ...(orders.length === 0
        ? [h('li', { class: 'muted' }, 'No orders with these statuses.')]
        : orders.map((o) =>
          h('li', {},
            h('button', { type: 'button', class: `order${this.detail?.number === o.number ? ' selected' : ''}`, onclick: () => this.open(o.number) },
              h('strong', {}, `#${o.number}`),
              h('span', { class: `status s-${o.status}` }, o.status),
              h('span', { class: 'muted' }, dateTime(o.submittedAt)),
              h('span', { class: 'summary' }, o.lines.map((l) => `${l.quantity} × ${l.dishName}`).join(', ')),
            ),
          ),
        )),
    );
    const current = this.detail && orders.find((o) => o.number === this.detail.number);
    this.detailChanged = Boolean(current && current.version !== this.detail.version);
    if (this.noticeEl) this.noticeEl.hidden = !this.detailChanged;
  }

  async open(number) {
    let result = null;
    try {
      result = await api(`/api/staff/orders/${number}`, { signal: AbortSignal.timeout(10000) });
    } catch {}
    if (result?.status === 401) return this.showSignIn('Your session ended. Please sign in again.');
    if (result?.status === 200) {
      this.detail = result.body.order;
      this.detailMessage = null;
      this.reasonDraft = '';
    } else {
      this.detailMessage = { kind: 'error', text: result ? 'Order not found.' : 'Could not load the order. Check the connection.' };
    }
    this.detailChanged = false;
    this.renderDetail();
    if (this.poller?.data) this.renderQueue(this.poller);
  }

  renderDetail() {
    const o = this.detail;
    const message = this.detailMessage && h('p', { class: this.detailMessage.kind, role: 'alert' }, this.detailMessage.text);
    if (!o) return fill($('detail'), h('p', { class: 'muted' }, 'Open an order to see its items and change its status.'), message);
    const next = NEXT[o.status];
    this.noticeEl = h('p', { class: 'warn', hidden: !this.detailChanged },
      'This order changed since you opened it. ',
      h('button', { type: 'button', class: 'link', onclick: () => this.open(o.number) }, 'Show the latest'));
    const reason = h('input', {
      name: 'reason', maxlength: 500, value: this.reasonDraft, placeholder: 'Reason the customer will see', 'aria-label': 'Cancellation reason',
      oninput: (e) => (this.reasonDraft = e.target.value),
    });
    fill($('detail'),
      h('h2', {}, `Order #${o.number}`),
      h('p', {}, 'Status: ', h('strong', { class: `status s-${o.status}` }, o.status), h('span', { class: 'muted' }, ` · version ${o.version}`)),
      h('p', { class: 'muted' }, `Submitted ${dateTime(o.submittedAt)}`),
      h('table', { class: 'items' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Qty'), h('th', {}, 'Item'), h('th', {}, 'Price'))),
        h('tbody', {}, o.lines.map((l) => h('tr', {}, h('td', {}, String(l.quantity)), h('td', {}, l.dishName), h('td', {}, money(l.price * l.quantity))))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'Total'), h('td', {}, money(o.total))))),
      o.cancellationReason && h('p', {}, 'Cancel reason: ', h('strong', {}, o.cancellationReason)),
      this.noticeEl,
      message,
      next && h('button', { type: 'button', class: 'primary', disabled: this.busy, onclick: () => this.change(o, next) }, `Mark ${next}`),
      next && h('form', {
        class: 'cancel',
        onsubmit: (e) => {
          e.preventDefault();
          this.change(o, 'Cancelled', reason.value);
        },
      }, reason, h('button', { disabled: this.busy }, 'Cancel order')),
      !next && h('p', { class: 'muted' }, `${o.status} is final. No more changes.`),
      o.statusChanges.length > 0 && h('details', {},
        h('summary', {}, 'History'),
        h('ul', {}, o.statusChanges.map((c) =>
          h('li', {}, `${clockTime(c.changedAt)}: ${c.fromStatus} → ${c.toStatus} by ${c.employeeId}${c.reason ? ` (${c.reason})` : ''}`)))),
    );
  }

  // Sends the version on screen. A 409 shows the current order and why; nothing is resent.
  async change(o, to, reason) {
    this.busy = true;
    this.renderDetail();
    let result = null;
    try {
      result = await api(`/api/staff/orders/${o.number}/status`, {
        method: 'POST', body: { version: o.version, to, reason }, signal: AbortSignal.timeout(10000),
      });
    } catch {}
    this.busy = false;
    if (result?.status === 401) return this.showSignIn('Your session ended, so the change was not saved. Please sign in again.');
    if (result?.status === 200) {
      this.detail = result.body.order;
      this.reasonDraft = '';
      this.detailMessage = { kind: 'ok', text: `Saved: order #${o.number} is now ${this.detail.status}.` };
    } else if (result?.status === 409) {
      this.detail = result.body.order;
      const last = this.detail.statusChanges.at(-1);
      const who = last ? ` (${last.employeeId} set it to ${last.toStatus} at ${clockTime(last.changedAt)})` : '';
      this.detailMessage = {
        kind: 'warn',
        text: `Not saved: someone else changed this order first${who}. It is now ${this.detail.status}. Nothing was resent. If your change is still valid, choose it again.`,
      };
    } else if (result?.status === 422) {
      if (result.body.order) this.detail = result.body.order;
      this.detailMessage = { kind: 'error', text: `Not saved. ${REFUSALS[result.body.reason] ?? 'That change is not allowed.'}` };
    } else if (result?.status === 404) {
      this.detailMessage = { kind: 'error', text: 'Order not found.' };
    } else {
      this.detailMessage = { kind: 'warn', text: 'No answer from the server, so the change may not be saved. Check the queue, then try again if it is still needed.' };
    }
    this.detailChanged = false;
    this.renderDetail();
    this.poller?.kick();
  }
}

new StaffPage().init();
