/**
 * http-set-cookie
 *
 * Parses a single Set-Cookie header value into a structured object.
 * Does NOT split a response's combined Set-Cookie headers — HTTP/1.1
 * joins them with commas, and splitting on commas is unreliable because
 * Expires dates also contain a comma (e.g. "Wed, 09 Jun 2021 10:18:14 GMT").
 * The caller is responsible for providing one cookie string at a time.
 */

/**
 * RFC 6265 attribute names we recognise. Stored lower-cased and without
 * the surrounding semicolons so we can do O(1) lookups while parsing.
 */
const ATTRIBUTE_NAMES = new Set([
  'domain',
  'path',
  'expires',
  'max-age',
  'secure',
  'httponly',
  'samesite',
]);

/**
 * @typedef {Object} Cookie
 * @property {string}           name
 * @property {string}           value
 * @property {string|null}      domain
 * @property {string|null}      path
 * @property {string|null}      expires   Raw Expires string, verbatim.
 * @property {number|null}      maxAge    Integer seconds, or null when absent/invalid.
 * @property {boolean}          secure
 * @property {boolean}          httpOnly
 * @property {string|null}      sameSite  "Strict", "Lax", or "None" if present and recognised, else null.
 * @property {Map<string,string>} extras  Unrecognised attributes, preserved verbatim so callers can inspect them.
 */

/**
 * Parse a single Set-Cookie header value.
 *
 * Edge cases handled:
 *  - Empty input → returns null.
 *  - Missing value (no '=') → the whole token becomes a cookie whose value is ''.
 *  - Surrounding whitespace is trimmed on the name/value pair and on each attribute.
 *  - Whitespace inside a quoted value is preserved.
 *  - Empty attribute values (e.g. "Domain=") are kept as '' rather than dropped, so the
 *    presence of the attribute is observable.
 *  - Unknown attributes (anything not in ATTRIBUTE_NAMES) are preserved in `extras`.
 *  - An invalid Max-Age (non-numeric or negative) is silently ignored: negative max-age
 *    is syntactically illegal per RFC 6265 §5.2.2, and a non-integer has no defined
 *    semantics, so we drop the attribute rather than guess.
 *
 * @param {string} header - One Set-Cookie header value (no leading "Set-Cookie:" prefix).
 * @returns {Cookie|null}
 */
export function parseSetCookie(header) {
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  const parts = header.split(';');

  // First part is the name=value pair. An empty first segment (header starting with ';')
  // yields no usable cookie name.
  const firstPart = parts.shift();
  if (firstPart === undefined) {
    return null;
  }

  const firstTrimmed = firstPart.trim();
  if (firstTrimmed === '') {
    // Leading semicolons with no name=value: nothing meaningful to return.
    return null;
  }

  const eqIdx = firstTrimmed.indexOf('=');
  let name;
  let value;
  if (eqIdx === -1) {
    name = firstTrimmed;
    value = '';
  } else {
    name = firstTrimmed.slice(0, eqIdx).trim();
    value = stripQuotes(firstTrimmed.slice(eqIdx + 1).trim());
  }

  if (name === '') {
    // "=value" with no name is not a valid cookie.
    return null;
  }

  const cookie = {
    name,
    value,
    domain: null,
    path: null,
    expires: null,
    maxAge: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    extras: new Map(),
  };

  for (const part of parts) {
    const seg = part.trim();
    if (seg === '') {
      continue;
    }

    const eq = seg.indexOf('=');
    let attrName;
    let attrValue;
    if (eq === -1) {
      attrName = seg.toLowerCase();
      attrValue = '';
    } else {
      attrName = seg.slice(0, eq).trim().toLowerCase();
      attrValue = seg.slice(eq + 1).trim();
    }

    switch (attrName) {
      case 'domain':
        // Preserve verbatim (no lower-casing of the value). RFC 6265 says Domain is
        // case-insensitive at comparison time, but callers may want the original form.
        cookie.domain = attrValue;
        break;
      case 'path':
        cookie.path = attrValue;
        break;
      case 'expires':
        // Keep the raw string. Date parsing in JS (Date.parse) is implementation-defined
        // for many of the formats servers send, so we do not attempt to normalise.
        cookie.expires = attrValue;
        break;
      case 'max-age': {
        // Max-Age must be a non-negative integer per RFC 6265 §5.2.2. Anything else is
        // dropped: there is no useful "best effort" interpretation of "-5" or "abc".
        const parsed = parseMaxAge(attrValue);
        if (parsed !== null) {
          cookie.maxAge = parsed;
        }
        break;
      }
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite': {
        const v = attrValue.toLowerCase();
        if (v === 'strict' || v === 'lax' || v === 'none') {
          // Normalise to the canonical capitalised form for easy comparison.
          cookie.sameSite = v === 'strict' ? 'Strict' : v === 'lax' ? 'Lax' : 'None';
        }
        break;
      }
      default:
        // Unknown attribute: store the first occurrence only, mirroring how
        // duplicate known attributes behave (last-wins) would require ordering
        // guarantees we don't claim. First-occurrence keeps `extras` simple and
        // deterministic.
        if (!cookie.extras.has(attrName)) {
          cookie.extras.set(attrName, attrValue);
        }
        break;
    }
  }

  return cookie;
}

/**
 * Strip surrounding double quotes from a cookie value, per RFC 6265 §4.1.1
 * quoted-string production. Only outer quotes are removed; inner quotes are
 * left intact because they are part of the value.
 *
 * We deliberately do NOT validate DQUOTE content against the RFC's
 * `qdtext`/`quoted-pair` grammar — real-world servers send values that
 * technically violate it, and rejecting them would be more disruptive than
 * the marginal compliance benefit.
 *
 * @param {string} v
 * @returns {string}
 */
function stripQuotes(v) {
  if (
    v.length >= 2 &&
    v.charCodeAt(0) === 0x22 /* " */ &&
    v.charCodeAt(v.length - 1) === 0x22
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse a Max-Age attribute value into a non-negative integer.
 *
 * @param {string} raw
 * @returns {number|null}
 */
function parseMaxAge(raw) {
  if (raw === '') {
    return null;
  }
  // Leading '+' is accepted by parseInt but is not permitted by the RFC; reject it
  // explicitly so behaviour is predictable.
  if (raw.charCodeAt(0) === 0x2b /* + */) {
    return null;
  }
  // Require the entire string to be digits. parseInt("12abc") → 12 would silently
  // accept trailing garbage, which is not what we want.
  if (!/^[0-9]+$/.test(raw)) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

/**
 * Format a Date as an RFC 6265 §5.1.1 IMDNF cookie date string.
 *
 * Provided so callers can generate Expires values without relying on their own
 * date formatting. Uses UTC explicitly — cookie Expires are always GMT — so the
 * output does not depend on the host's local timezone, which keeps tests
 * deterministic.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('formatDate requires a valid Date instance');
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad = (n) => String(n).padStart(2, '0');
  return (
    days[date.getUTCDay()] +
    ', ' +
    pad(date.getUTCDate()) +
    ' ' +
    months[date.getUTCMonth()] +
    ' ' +
    date.getUTCFullYear() +
    ' ' +
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds()) +
    ' GMT'
  );
}
