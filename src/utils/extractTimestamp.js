function extractTimestamp(text, fallback) {
  if (typeof text !== 'string') return fallback;
  const match = text.match(/timestamp\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2})?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)/i);
  if (match) {
    let ts = match[1].trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ts)) {
      ts += ':00';
    }
    const d = new Date(ts);
    if (!isNaN(d)) return d.toISOString();
  }
  return fallback;
}

module.exports = extractTimestamp;
