import { $, badge, escape, itemSummary, localTime, orderNumber, statusMessage } from './common.js';
import { observe } from './updates.js';

const content = $('#tracking-content');
const warning = $('#tracking-warning');
const checked = $('#checked');
let hasSnapshot = false;
let currentStatus;

observe('/api' + location.pathname, {
  success({ order, timezone, guidance }, at) {
    if (currentStatus !== order.status) {
      currentStatus = order.status;
      content.innerHTML = `
        <div class="tracking-state" role="status">
          <div>${badge(order.status)} <strong>Order ${orderNumber(order.number)}</strong></div>
          <p>${statusMessage[order.status]}</p>
          ${order.status === 'Ready' ? `<p><strong>Pickup location:</strong> ${escape(guidance.pickupLocation)}</p>
            <p>${escape(guidance.pickupInstructions)} Your pickup number is <strong>${orderNumber(order.number)}</strong>.</p>` : ''}
          ${order.status === 'Cancelled' ? `<p><strong>Reason:</strong> <span class="reason">${escape(order.reason)}</span></p>
            <p>${escape(guidance.contactLabel)} · ${escape(guidance.contact)}</p>` : ''}
        </div>
        <p class="small">Submitted ${localTime(order.submittedAt, timezone, true)} · Costa Rica time</p>
        ${itemSummary(order)}`;
    }
    hasSnapshot = true;
    checked.textContent = 'Last checked ' + localTime(at, timezone) + ' · Costa Rica time';
    checked.hidden = false;
    warning.hidden = true;
  },
  failure(error) {
    if (error.status === 404) {
      content.textContent = '';
      checked.hidden = true;
      warning.textContent = "We couldn't open this tracking link. Check the full saved link.";
      warning.hidden = false;
      return false;
    }
    if (!hasSnapshot) content.textContent = '';
    const text = currentStatus === 'Ready'
      ? 'Updates are unavailable. This status may be out of date. Check again before heading to the pickup counter.'
      : hasSnapshot ? 'Updates are unavailable. This status may be out of date.'
        : 'Updates are unavailable. Trying again…';
    if (warning.textContent !== text) warning.textContent = text;
    warning.hidden = false;
  },
});
