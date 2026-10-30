# http-set-cookie

Parses a single `Set-Cookie` header value into a structured object with `name`, `value`, `domain`, `path`, `expires`, `maxAge`, `secure`, `httpOnly`, `sameSite`, and an `extras` map for unrecognised attributes.

## Usage

```js
import { parseSetCookie, formatDate } from 'http-set-cookie';

const cookie = parseSetCookie('session=abc123; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax');
console.log(cookie.name);    // 'session'
console.log(cookie.value);   // 'abc123'
console.log(cookie.path);    // '/'
console.log(cookie.maxAge);  // 3600
console.log(cookie.secure);  // true
console.log(cookie.httpOnly);// true
console.log(cookie.sameSite);// 'Lax'

// Generate an Expires value (UTC, deterministic):
const expires = formatDate(new Date(Date.UTC(2025, 0, 1, 0, 0, 0)));
// 'Wed, 01 Jan 2025 00:00:00 GMT'
```

## Why this exists

`Set-Cookie` is a deceptively fiddly header: it carries a name/value pair followed by
space-flexible, case-insensitive attributes, quoted values, and an `Expires` date that
itself contains a comma. This library parses one cookie string into a predictable shape
without pulling in a dependency tree.

The deliberate scope boundary: **this parses one `Set-Cookie` value, not a response's
combined header block.** RFC 6265 says a server may send multiple `Set-Cookie` headers,
and HTTP/1.1 joins headers with commas — but splitting on commas is unsafe because the
`Expires` date contains a comma (e.g. `Wed, 09 Jun 2021 10:18:14 GMT`). Feeding each
individual header value to `parseSetCookie` is the caller's job.

## Edge cases you will hit

- **`Expires` is returned verbatim, as a string.** JS `Date.parse` is
  implementation-defined for several date formats servers send, so normalising to a
  `Date` would trade reliability for convenience. If you need a `Date`, parse it yourself
  and handle the failure mode you are willing to accept.
- **Invalid `Max-Age` is dropped, not coerced.** A negative or non-numeric `Max-Age` is
  syntactically illegal per RFC 6265 §5.2.2; we set `maxAge` to `null` rather than guess.
- **Unknown attributes land in `extras`.** `SameParty`, `Priority`, and future attributes
  are preserved as a `Map<string, string>` (attribute name lower-cased, value verbatim).
- **Duplicate known attributes: last-wins.** Duplicate unknown attributes: first-wins.
  This keeps `extras` deterministic without claiming RFC-mandated behaviour the spec does
  not specify.
- **Quoted values have only their outer quotes stripped.** Inner quotes are preserved as
  part of the value. We do not validate against the RFC's `quoted-pair` grammar because
  real servers send values that technically violate it.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

## Contributing

Issues and pull requests are welcome. Please keep the dependency list empty —
that constraint is the point of the project, not an oversight.

