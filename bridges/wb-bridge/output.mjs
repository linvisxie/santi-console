// WorkBuddy can emit a JSON transcript array, a result object, or NDJSON.
// Only return the final result; never forward user prompts or reasoning records.
export function parseCliOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return { text: '', failed: false };
  let records;
  try {
    const parsed = JSON.parse(trimmed);
    records = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    records = trimmed.split(/\r?\n/).flatMap(line => {
      try {
        const value = JSON.parse(line);
        return Array.isArray(value) ? value : [value];
      } catch { return []; }
    });
  }
  for (const record of [...records].reverse()) {
    if (record && (record.type === 'result' || typeof record.result === 'string')) {
      const failed = record.is_error === true ||
        (typeof record.subtype === 'string' && record.subtype !== 'success');
      return { text: typeof record.result === 'string' ? record.result.trim() : '', failed };
    }
  }
  // Plain-text CLI errors are needed for authentication detection. Structured
  // transcripts without a completion record must not be mistaken for success.
  if (records.length || /^[\[{]/.test(trimmed)) return { text: '', failed: true };
  return { text: trimmed, failed: false };
}
