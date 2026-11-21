// Fast csv-reader 1.0.0 drop-in: returns exactly csv-reader's answer for every
// input, faster. Written from the reference semantics in the kit (RULES.txt and
// vendor/csv-reader/index.js), not copied from it.
//
// Strategy: one pass, left to right. Clean unquoted fields are taken with two
// indexOf scans (',' and the record's line end, cached) and one slice -- no
// per-character loop. Quoted
// fields find their closing quote with indexOf, skipping "" escapes, and slice
// the content when it holds no newline and no escape. The slow character loop
// runs only for fields that actually contain an anomaly: a CR inside an
// unquoted field, an escaped quote, a line break inside quotes, junk after a
// closing quote, or a quote that never closes.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  // Output slots of unq(): the field it read, how it ended, where it stopped.
  // Shared on purpose: returning a fresh object per field (hundreds of
  // thousands per set) costs more in allocation and GC than the values do.
  let uValue = '';
  let uEnded = END;
  let uPos = 0;
  // Index of the first LF at or after the position it was last computed for
  // (-1: none). Valid while it is at or after the read position: the first
  // LF after an earlier position is the first LF after any later position
  // up to it, so unquoted fields share one scan per record instead of one
  // scan per field.
  let lineEnd = -1;
  let recordLine = 1;
  let recordRow = null;

  // Read one unquoted field starting at `start`, with `prefix` already in the
  // value. Writes uValue / uEnded / uPos; ended is COMMA, BREAK or END.
  // A CR inside the field span falls back to the character loop below.
  function unq(start, prefix) {
    let comma = text.indexOf(',', start);
    if (lineEnd < start) lineEnd = text.indexOf('\n', start);
    const lf = lineEnd === -1 ? n : lineEnd;
    if (comma === -1) comma = n;
    let v;
    let ended;
    let endPos;
    let adv = 0;
    if (comma < lf) {
      v = prefix ? prefix + text.slice(start, comma) : text.slice(start, comma);
      ended = COMMA;
      endPos = comma + 1;
    } else if (lf < n) {
      const fe = lf > start && text.charCodeAt(lf - 1) === 13 ? lf - 1 : lf;
      v = prefix ? prefix + text.slice(start, fe) : text.slice(start, fe);
      ended = BREAK;
      endPos = lf + 1;
      adv = 1;
    } else {
      v = prefix ? prefix + text.slice(start, n) : text.slice(start, n);
      ended = END;
      endPos = n;
    }
    if (v.indexOf('\r', prefix.length) === -1) {
      line += adv;
      uValue = v;
      uEnded = ended;
      uPos = endPos;
      return;
    }
    // Slow path: a CR sits inside the field span. Re-read it char by char:
    // a CR not followed by LF is dropped (stray_cr), CRLF ends the record.
    let w = prefix;
    let p = start;
    let e2 = END;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        e2 = COMMA;
        p += 1;
        break;
      }
      if (c === 10) {
        e2 = BREAK;
        line += 1;
        p += 1;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          e2 = BREAK;
          line += 1;
          p += 2;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        p += 1;
        continue;
      }
      w += text[p];
      p += 1;
    }
    uValue = w;
    uEnded = e2;
    uPos = p;
  }

  outer: while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = END;
    let value = '';
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        let q = text.indexOf('"', open + 1);
        let hasEsc = false;
        while (q !== -1 && text.charCodeAt(q + 1) === 34) {
          hasEsc = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          unq(open + 1, '"');
          value = uValue;
          ended = uEnded;
          pos = uPos;
        } else {
          const content = text.slice(open + 1, q);
          let val;
          if (!hasEsc && content.indexOf('\n') === -1 && content.indexOf('\r') === -1) {
            val = content;
          } else {
            // Slow content: "" is one quote, CRLF and lone CR inside are LF.
            let w = '';
            let i = open + 1;
            while (i < q) {
              const c = text.charCodeAt(i);
              if (c === 34) {
                w += '"';
                i += text.charCodeAt(i + 1) === 34 ? 2 : 1;
                continue;
              }
              if (c === 13) {
                w += '\n';
                line += 1;
                i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
                continue;
              }
              if (c === 10) line += 1;
              w += text[i];
              i += 1;
            }
            val = w;
          }
          const nx = q + 1;
          if (nx >= n) {
            value = val;
            ended = END;
            pos = n;
          } else {
            const c = text.charCodeAt(nx);
            if (c === 44) {
              value = val;
              ended = COMMA;
              pos = nx + 1;
            } else if (c === 10) {
              value = val;
              ended = BREAK;
              line += 1;
              pos = nx + 1;
            } else if (c === 13 && text.charCodeAt(nx + 1) === 10) {
              value = val;
              ended = BREAK;
              line += 1;
              pos = nx + 2;
            } else {
              // What follows the closing quote is appended as it stands.
              unq(nx, val);
              if (uValue.length > val.length) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              value = uValue;
              ended = uEnded;
              pos = uPos;
            }
          }
        }
      } else {
        lastQuoted = false;
        // Inline the unquoted fast path: the closure call per field costs
        // more than the two indexOf scans it wraps. The closure stays for
        // the rare fallbacks (junk, unterminated quote, CR inside a field).
        let comma = text.indexOf(',', pos);
        if (lineEnd < pos) lineEnd = text.indexOf('\n', pos);
        const lf = lineEnd === -1 ? n : lineEnd;
        if (comma === -1) comma = n;
        if (comma < lf) {
          value = text.slice(pos, comma);
          if (value.indexOf('\r') === -1) {
            ended = COMMA;
            pos = comma + 1;
          } else {
            unq(pos, '');
            value = uValue;
            ended = uEnded;
            pos = uPos;
          }
        } else if (lf < n) {
          const fe = lf > pos && text.charCodeAt(lf - 1) === 13 ? lf - 1 : lf;
          value = text.slice(pos, fe);
          if (value.indexOf('\r') === -1) {
            ended = BREAK;
            line += 1;
            pos = lf + 1;
          } else {
            unq(pos, '');
            value = uValue;
            ended = uEnded;
            pos = uPos;
          }
        } else {
          value = text.slice(pos, n);
          if (value.indexOf('\r') === -1) {
            ended = END;
            pos = n;
          } else {
            unq(pos, '');
            value = uValue;
            ended = uEnded;
            pos = uPos;
          }
        }
      }
      fields.push(value);
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue outer;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue outer;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
