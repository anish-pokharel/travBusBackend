const crypto = require('crypto');
const cfg = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Each provider exposes:
 *   initiate({ payment, booking }) -> data the frontend needs to start payment
 *   verify(payload)                -> { ok, transactionRef, providerRef, amount, raw } verified SERVER-SIDE
 * Add a new gateway by adding another entry here (and to the Payment.method enum).
 */

const esewa = {
  sign(message) {
    return crypto.createHmac('sha256', cfg.esewa.secret).update(message).digest('base64');
  },
  async initiate({ payment }) {
    if (!cfg.esewa.secret) throw ApiError.badRequest('eSewa is not configured on the server');
    const total = Number(payment.amount).toFixed(2);
    const fields = {
      amount: total,
      tax_amount: '0',
      total_amount: total,
      transaction_uuid: payment.transactionRef,
      product_code: cfg.esewa.productCode,
      product_service_charge: '0',
      product_delivery_charge: '0',
      success_url: `${cfg.frontendUrl}/payment/esewa/success`,
      failure_url: `${cfg.frontendUrl}/payment/esewa/failure`,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
    };
    fields.signature = this.sign(`total_amount=${fields.total_amount},transaction_uuid=${fields.transaction_uuid},product_code=${fields.product_code}`);
    return { type: 'form', method: 'POST', url: cfg.esewa.formUrl, fields };
  },
  async verify({ data }) {
    if (!data) throw ApiError.badRequest('Missing eSewa data');
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(String(data), 'base64').toString('utf8'));
    } catch {
      throw ApiError.badRequest('Malformed eSewa response');
    }
    // 1) verify the signature on the callback
    const names = String(decoded.signed_field_names || '').split(',');
    const message = names.map((n) => `${n}=${decoded[n]}`).join(',');
    const expected = Buffer.from(this.sign(message));
    const given = Buffer.from(String(decoded.signature || ''));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      throw ApiError.badRequest('Invalid payment signature');
    }
    if (decoded.status !== 'COMPLETE') return { ok: false, transactionRef: decoded.transaction_uuid, raw: decoded };

    // 2) confirm with eSewa's status API (never rely on the browser redirect alone)
    const url = `${cfg.esewa.statusUrl}?product_code=${encodeURIComponent(decoded.product_code)}&total_amount=${encodeURIComponent(decoded.total_amount)}&transaction_uuid=${encodeURIComponent(decoded.transaction_uuid)}`;
    const resp = await fetch(url);
    const status = await resp.json().catch(() => ({}));
    const ok = status.status === 'COMPLETE';
    return {
      ok,
      transactionRef: decoded.transaction_uuid,
      providerRef: status.ref_id || decoded.transaction_code,
      amount: Number(String(decoded.total_amount).replace(/,/g, '')),
      raw: { callback: decoded, status },
    };
  },
};

const khalti = {
  headers() {
    return { Authorization: `Key ${cfg.khalti.secret}`, 'Content-Type': 'application/json' };
  },
  async initiate({ payment, booking }) {
    if (!cfg.khalti.secret) throw ApiError.badRequest('Khalti is not configured on the server');
    const resp = await fetch(`${cfg.khalti.baseUrl}/epayment/initiate/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        return_url: `${cfg.frontendUrl}/payment/khalti/return`,
        website_url: cfg.frontendUrl,
        amount: Math.round(payment.amount * 100), // paisa
        purchase_order_id: payment.transactionRef,
        purchase_order_name: `Ticket ${booking._id}`,
        customer_info: { name: booking.contact?.name || 'Passenger', phone: booking.contact?.phone || '9800000000', email: booking.contact?.email || 'noreply@example.com' },
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.pidx) throw ApiError.badRequest('Khalti could not start the payment', json);
    return { type: 'redirect', url: json.payment_url, pidx: json.pidx };
  },
  async verify({ pidx }) {
    if (!pidx) throw ApiError.badRequest('Missing pidx');
    const resp = await fetch(`${cfg.khalti.baseUrl}/epayment/lookup/`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ pidx }),
    });
    const json = await resp.json().catch(() => ({}));
    return {
      ok: json.status === 'Completed',
      pidx,
      providerRef: json.transaction_id || pidx,
      amount: json.total_amount ? json.total_amount / 100 : undefined,
      raw: json,
    };
  },
};

module.exports = { esewa, khalti };
