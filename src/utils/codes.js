const crypto = require('crypto');
const { ticketSecret } = require('../config/env');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const generatePNR = () => randomCode(8);
const generateTicketNo = () => `TKT-${Date.now().toString(36).toUpperCase()}-${randomCode(4)}`;
const generateReservationId = () => crypto.randomUUID();

const signPNR = (pnr) =>
  crypto.createHmac('sha256', ticketSecret).update(pnr).digest('hex').slice(0, 16);

const verifySignature = (pnr, sig) => {
  const expected = Buffer.from(signPNR(pnr));
  const given = Buffer.from(String(sig || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

// QR payload: "PNR.signature" -> frontend /verify/:code
const qrCode = (pnr) => `${pnr}.${signPNR(pnr)}`;

module.exports = { generatePNR, generateTicketNo, generateReservationId, qrCode, verifySignature };
