// Taller — on-device full-text search over manual pages (MiniSearch, MIT).
// Index docs are page *parts* (chunks): id = "manualId::page::part".
// Only ids/manualId/page are stored in the index; page text lives in IndexedDB.

import { db } from './db.js';

const MS = () => {
  const g = window.MiniSearch;
  return g && (g.default || g);
};

const INDEX_KEY = 'searchIndex-v1';

// Glue words in EN/FR/ES that only add noise to fault queries.
// Deliberately NOT included: "no", "not", "pas" (meaningful in faults: "no suction").
const STOP = new Set([
  // en
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was', 'were',
  'be', 'been', 'it', 'its', 'as', 'by', 'for', 'with', 'from', 'that', 'this', 'these',
  'my', 'your', 'when', 'while', 'then', 'than', 'there',
  // fr
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'au', 'aux', 'pour',
  'avec', 'est', 'sont', 'sur', 'dans', 'ce', 'cette', 'ces', 'que', 'qui', 'se', 'sa', 'son', 'ses',
  // es
  'el', 'los', 'una', 'unos', 'unas', 'del', 'y', 'o', 'para', 'con', 'es', 'son',
  'en', 'este', 'esta', 'estos', 'estas', 'lo', 'mi', 'tu', 'su', 'sus', 'hay',
]);

const OPTIONS = {
  fields: ['text'],
  storeFields: ['manualId', 'page'],
  processTerm: (term) => {
    const t = term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (STOP.has(t)) return null;
    return t.length > 30 ? t.slice(0, 30) : t;
  },
};

let _index = null;
let _dirty = false;

export async function ensureIndex() {
  if (_index) return _index;
  const MiniSearch = MS();
  const saved = await db.kvGet(INDEX_KEY);
  if (saved) {
    try {
      _index = MiniSearch.loadJSON(saved, OPTIONS);
      return _index;
    } catch (e) {
      console.warn('index load failed, rebuilding empty', e);
    }
  }
  _index = new MiniSearch(OPTIONS);
  return _index;
}

export async function persistIndex() {
  if (!_index || !_dirty) return;
  await db.kvSet(INDEX_KEY, JSON.stringify(_index));
  _dirty = false;
}

// Split page text into chunks of ~1600 chars on paragraph/sentence boundaries.
export function splitParts(text, target = 1600, max = 2400) {
  if (!text) return [];
  if (text.length <= max) return [text];
  const paras = text.split(/\n{2,}/);
  const parts = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (let para of paras) {
    if (para.length > max) {
      // hard-split long paragraphs on sentence-ish boundaries
      const bits = para.split(/(?<=[.;:!?])\s+/);
      for (const b of bits) {
        if ((cur + ' ' + b).length > target) push();
        cur += (cur ? ' ' : '') + b;
        if (cur.length > max) push();
      }
    } else {
      if ((cur + '\n\n' + para).length > target) push();
      cur += (cur ? '\n\n' : '') + para;
    }
  }
  push();
  return parts.length ? parts : [text.slice(0, max)];
}

// Add all pages of a manual to the index. pages: [{page, text}]
// Returns records with parts counts for storage: [{manualId, page, text, parts}]
export async function indexManual(manualId, pages, onProgress) {
  const index = await ensureIndex();
  const records = [];
  const docs = [];
  for (const { page, text } of pages) {
    const parts = splitParts(text);
    records.push({ manualId, page, text, parts: parts.length });
    parts.forEach((partText, i) => {
      docs.push({ id: `${manualId}::${page}::${i}`, manualId, page, text: partText });
    });
  }
  // Add in batches to keep the UI responsive.
  // MiniSearch THROWS on a duplicate id. That used to abort every OCR run on a
  // copier-produced scan: such pages carry a short text layer ("Page 4 of 88"),
  // which is enough for splitParts to create doc id "…::page::0" at import but
  // NOT enough (>20 chars) for OCR to skip the page — so OCR re-added the same
  // id, threw, and discarded 20+ minutes of work before anything was saved.
  // Discard-then-add makes re-indexing idempotent.
  const BATCH = 200;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    for (const d of batch) {
      try { if (index.has(d.id)) index.discard(d.id); } catch (e) { /* ignore */ }
    }
    index.addAll(batch);
    if (onProgress) onProgress(Math.min(i + BATCH, docs.length), docs.length);
    await new Promise(r => setTimeout(r, 0));
  }
  _dirty = true;
  await persistIndex(); // persist reliably so search survives an immediate reload
  return records;
}

// Remove index entries for specific pages of a manual, given the in-memory
// page records. Used by the import-failure cleanup path, where the page rows
// were never written to IndexedDB and so unindexManual() would find nothing.
export async function unindexPages(manualId, pageRecords) {
  const index = await ensureIndex();
  for (const rec of pageRecords) {
    const n = rec.parts || 1;
    for (let i = 0; i < n; i++) {
      const id = `${manualId}::${rec.page}::${i}`;
      try { if (index.has(id)) index.discard(id); } catch (e) { /* ignore */ }
    }
  }
  _dirty = true;
}

export async function unindexManual(manualId) {
  const index = await ensureIndex();
  const pages = await db.getPagesForManual(manualId);
  for (const rec of pages) {
    const n = rec.parts || 1;
    for (let i = 0; i < n; i++) {
      const id = `${manualId}::${rec.page}::${i}`;
      try { if (index.has(id)) index.discard(id); } catch (e) { /* ignore */ }
    }
  }
  _dirty = true;
  await persistIndex();
}

// Search. Returns { terms, hits: [{manualId, page, score}] } grouped by page.
export async function searchPages(query, { manualId = null, limit = 12 } = {}) {
  const index = await ensureIndex();
  if (!query || !query.trim()) return { terms: [], hits: [] };
  const opts = {
    prefix: (term) => term.length >= 3,
    fuzzy: (term) => (term.length > 4 ? 0.2 : false),
    combineWith: 'OR',
  };
  if (manualId) opts.filter = (r) => r.manualId === manualId;
  let raw = [];
  try { raw = index.search(query, opts); } catch (e) { raw = []; }

  // Re-rank: strongly prefer chunks matching MORE distinct query terms, and
  // give error-code-like tokens (e4, f1, sp100…) extra weight — they are the
  // highest-signal words in fault queries.
  const CODE = /^[a-z]{1,3}-?\d{1,4}[a-z]?$/;
  for (const r of raw) {
    const terms = r.terms || [];
    let s = r.score * Math.pow(Math.max(terms.length, 1), 1.4);
    if (terms.some(tm => CODE.test(tm))) s *= 2.2;
    r._adj = s;
  }
  raw.sort((a, b) => b._adj - a._adj);

  const byPage = new Map();
  const termSet = new Set();
  for (const r of raw.slice(0, 80)) {
    (r.terms || []).forEach(t => termSet.add(t));
    const key = `${r.manualId}::${r.page}`;
    const prev = byPage.get(key);
    if (prev) prev.score += r._adj * 0.6; // extra parts of same page add less
    else byPage.set(key, { manualId: r.manualId, page: r.page, score: r._adj });
  }
  const hits = [...byPage.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  // How much of what the technician actually ASKED was found?
  // Raw MiniSearch score is a bad confidence signal on its own: it scales with
  // query length and term frequency, so a five-word question about a machine
  // whose manual is not even imported can outscore a precise two-word one.
  // Coverage is what discriminates. Note matched terms are INDEX terms after
  // fuzzy/prefix expansion, so "rotor" matching "motor" must NOT count as
  // coverage — only exact or prefix relationships do.
  const matched = [...termSet];
  const qTerms = [...new Set(
    String(query).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w))
  )];
  const covered = qTerms.filter(q => matched.some(m => m === q || m.startsWith(q) || q.startsWith(m)));
  const coverage = qTerms.length ? covered.length / qTerms.length : 0;
  const density = hits.length ? hits[0].score / Math.max(1, qTerms.length) : 0;

  return { terms: matched, hits, coverage, density, queryTerms: qTerms.length };
}

// Build a text snippet around the first matched term.
export function makeSnippet(text, terms, len = 240) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let pos = -1;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return clean.slice(0, len) + (clean.length > len ? '…' : '');
  const start = Math.max(0, pos - Math.floor(len / 3));
  const end = Math.min(clean.length, start + len);
  return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
}

// Retrieval for the assistant: top pages with their full-page excerpts.
// `partial` marks an excerpt that is only a WINDOW of the page — the assistant
// must know this, because a 9-step procedure trimmed to 1800 chars around the
// first matched term silently loses steps at both ends, and a confident
// "4-step procedure, p. 61" built from it is dangerous.
export async function retrieveExcerpts(question, { manualId = null, maxPages = 6, maxChars = 1800 } = {}) {
  const { terms, hits, coverage, density, queryTerms } = await searchPages(question, { manualId, limit: maxPages * 2 });
  const out = [];
  const manualCache = new Map(); // avoid re-fetching the same manual per hit
  for (const h of hits.slice(0, maxPages)) {
    const rec = await db.getPage(h.manualId, h.page);
    if (!rec || !rec.text) continue;
    if (!manualCache.has(h.manualId)) manualCache.set(h.manualId, await db.getManual(h.manualId));
    const manual = manualCache.get(h.manualId);
    const full = rec.text.replace(/\s+/g, ' ').trim();
    let text = full;
    let partial = false;
    if (text.length > maxChars) {
      text = makeSnippet(rec.text, terms, maxChars);
      partial = true;
    }
    out.push({
      manualId: h.manualId, manualName: manual ? manual.name : '?',
      page: h.page, text, partial, score: h.score,
    });
  }
  return {
    terms, excerpts: out,
    topScore: out.length ? out[0].score : 0,
    coverage, density, queryTerms,
    confidence: out.length ? confidenceOf({ coverage, density }) : 'weak',
  };
}

// Confidence of a retrieval. Because matching is OR + fuzzy + prefix, ONE
// loosely-matching common word is enough to return "results": asking how to
// service a ventilator expiratory valve while only a suction-pump manual is
// imported used to return six confident-looking, entirely off-topic pages —
// and then hand them to the assistant as "the sole source of truth".
//
// Two signals, both required:
//   coverage — fraction of the question's own words actually found (the real
//              discriminator: unrelated questions match 1-2 generic words)
//   density  — top score per question word (catches the case where the one
//              covered word is simply common, e.g. "blade")
export const RELEVANCE = { minCoverage: 0.6, minDensity: 6, goodCoverage: 0.75, goodDensity: 15 };
export function confidenceOf(r) {
  if (!r) return 'weak';
  const cov = typeof r === 'number' ? 1 : (r.coverage || 0);
  const den = typeof r === 'number' ? r : (r.density || 0);
  if (!den || cov < RELEVANCE.minCoverage || den < RELEVANCE.minDensity) return 'weak';
  if (cov >= RELEVANCE.goodCoverage && den >= RELEVANCE.goodDensity) return 'good';
  return 'fair';
}
