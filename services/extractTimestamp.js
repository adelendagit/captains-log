function extractTimestamp(text, fallback) {
  let match = text.match(/timestamp:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/i);
  if (!match) {
    match = text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  }
  if (match) {
    const ts = match[1].trim().replace(' ', 'T');
    const d = new Date(ts.length === 16 ? ts + ':00' : ts);
    if (!isNaN(d)) return d.toISOString();
  }
  return fallback;
}

module.exports = { extractTimestamp };
