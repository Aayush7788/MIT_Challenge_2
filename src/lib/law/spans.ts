// Checks that a quoted span really appears in its source document, and repairs
// small copy errors (whitespace, curly quotes, dropped words) by snapping to the
// closest passage that does appear. The returned span is always the exact raw
// text from the document, so a plain substring check on the corpus finds it.

function normalize(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return normalize(s).toLowerCase().match(/[a-z0-9§.%$]+/g) ?? [];
}

// Finds the raw document text matching a normalized span (whitespace, quote and
// dash variants allowed).
function findRaw(normTarget: string, rawDoc: string): string | null {
  const pattern = normTarget
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+")
    .replace(/'/g, "['‘’‚‛]")
    .replace(/"/g, '["“”„‟]')
    .replace(/-/g, "[-–—]");
  try {
    const m = rawDoc.match(new RegExp(pattern));
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export type SpanCheck = { span: string; verified: boolean; repaired: boolean };

export function verifySpan(span: string, docText: string): SpanCheck {
  const target = normalize(span);
  if (target.length >= 20) {
    const raw = findRaw(target, docText);
    if (raw) return { span: raw, verified: true, repaired: false };
  }

  // Snap to the best window of 1-4 consecutive sentences, scored by word overlap.
  const targetWords = words(span);
  if (targetWords.length < 4) return { span, verified: false, repaired: false };
  const want = new Set(targetWords);
  const pieces = docText
    .split(/(?<=[.;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let best = { score: 0, text: "" };
  for (let i = 0; i < pieces.length; i++) {
    let text = "";
    for (let j = i; j < Math.min(pieces.length, i + 4); j++) {
      text = text ? `${text} ${pieces[j]}` : pieces[j];
      const w = words(text);
      const overlap = w.filter((x) => want.has(x)).length;
      const score = (2 * overlap) / (w.length + targetWords.length);
      if (score > best.score) best = { score, text };
    }
  }
  if (best.score >= 0.75) {
    const raw = findRaw(normalize(best.text), docText);
    if (raw && raw.length >= 20) return { span: raw, verified: true, repaired: true };
  }
  return { span, verified: false, repaired: false };
}
