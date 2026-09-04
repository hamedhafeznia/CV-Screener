import { readFile } from 'node:fs/promises';
import { extractTextItems, getDocumentProxy, renderPageAsImage, type StructuredTextItem } from 'unpdf';
import { generateText } from 'ai';
import { textModel } from '../llm';

/**
 * Stage 1 of ingest (PRD §6): PDF -> text, one string per page.
 *
 * Two things make this more than a one-liner:
 *
 *  - Two-column CVs. pdf.js hands back text items in content-stream order, which
 *    for the `sidebar` template interleaves the dark sidebar with the main
 *    column ("Contact Xavier Prieto xavier@... Data Scientist"). We detect the
 *    gutter from item geometry and read column by column.
 *  - Image-only CVs. One PDF in the corpus is a flattened bitmap with no text
 *    layer at all. Pages that come back near-empty are rasterised and sent to
 *    the vision model instead.
 */

export type PageSource = 'text' | 'vision' | 'empty';

export interface ExtractedPage {
  page: number;
  text: string;
  source: PageSource;
  columns: number;
}

export interface ExtractedPdf {
  numPages: number;
  pages: ExtractedPage[];
}

/**
 * Below this, a page is assumed to carry no text layer at all.
 *
 * Deliberately low. A CV that overflows onto a second page often leaves only a
 * line or two there, and that is real extractable text — sending it to the
 * vision model would spend a request to re-read something we already have. The
 * case this threshold is for is the flattened-bitmap CV, which yields zero.
 */
const MIN_PAGE_CHARS = 20;

interface Line {
  y: number;
  minX: number;
  maxX: number;
  items: StructuredTextItem[];
}

/** Cluster items into visual lines. PDF origin is bottom-left, so y descends. */
function toLines(items: StructuredTextItem[]): Line[] {
  const sorted = [...items].filter((i) => i.str.trim().length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];

  for (const item of sorted) {
    const tolerance = Math.max(2, (item.fontSize || 10) * 0.5);
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= tolerance) {
      line.items.push(item);
      line.minX = Math.min(line.minX, item.x);
      line.maxX = Math.max(line.maxX, item.x + item.width);
    } else {
      lines.push({ y: item.y, minX: item.x, maxX: item.x + item.width, items: [item] });
    }
  }

  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Find a vertical gutter: a band, in the middle of the text area, that almost no
 * text crosses. Returns its x centre, or null for a single-column page.
 *
 * This runs on raw items rather than on lines, because line clustering is only
 * correct *after* the columns are separated — a sidebar entry and a main-column
 * entry at the same height are not one line, and grouping them first is exactly
 * the bug that makes naive extraction unreadable.
 *
 * The crossing tolerance is deliberately non-zero: the `modern` template puts a
 * full-width header band above a two-column body, and those few crossing runs
 * must not hide an otherwise obvious gutter.
 */
function findGutter(items: StructuredTextItem[]): number | null {
  const real = items.filter((i) => i.str.trim().length > 0);
  if (real.length < 30) return null;

  const minX = Math.min(...real.map((i) => i.x));
  const maxX = Math.max(...real.map((i) => i.x + i.width));
  const width = maxX - minX;
  if (width < 150) return null;

  const BIN = 2;
  const bins = Math.ceil(width / BIN);
  const crossings = new Array<number>(bins).fill(0);
  for (const item of real) {
    const from = Math.max(0, Math.floor((item.x - minX) / BIN));
    const to = Math.min(bins - 1, Math.ceil((item.x + item.width - minX) / BIN));
    for (let b = from; b <= to; b++) crossings[b]++;
  }

  const maxCrossings = Math.max(1, Math.round(real.length * 0.03));
  const loBin = Math.floor(bins * 0.15);
  const hiBin = Math.ceil(bins * 0.85);

  // Widest run of low-crossing bins inside the central band.
  const runs: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let b = loBin; b <= hiBin; b++) {
    if (crossings[b] <= maxCrossings) {
      if (runStart < 0) runStart = b;
    } else if (runStart >= 0) {
      runs.push({ start: runStart, end: b });
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push({ start: runStart, end: hiBin + 1 });

  const best = runs.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (!best || (best.end - best.start) * BIN < 12) return null;
  const gutterX = minX + ((best.start + best.end) / 2) * BIN;

  // A gutter only means anything if both sides actually hold content.
  const left = real.filter((i) => i.x + i.width <= gutterX).length;
  const right = real.filter((i) => i.x >= gutterX).length;
  if (left < real.length * 0.2 || right < real.length * 0.2) return null;

  return gutterX;
}

/**
 * Repair CSS letter-spacing. `letter-spacing: 1.4px` on a heading makes pdf.js
 * emit one run per glyph, so "EDUCATION" arrives as "E D U C AT I O N". A run of
 * three or more short uppercase tokens is a spaced-out heading, not words.
 */
function repairLetterSpacing(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  let run: string[] = [];
  const isFragment = (t: string) => t.length > 0 && t.length <= 2 && t === t.toUpperCase() && /^[^\d\s]+$/u.test(t);
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const token of tokens) {
    if (isFragment(token)) run.push(token);
    else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(' ');
}

function lineText(line: Line): string {
  let out = '';
  let prevEnd: number | null = null;
  for (const item of line.items) {
    // pdf.js emits per-run items; a visible gap means a space was consumed.
    if (prevEnd !== null && item.x - prevEnd > (item.fontSize || 10) * 0.2 && !out.endsWith(' ')) out += ' ';
    out += item.str;
    prevEnd = item.x + item.width;
  }
  return repairLetterSpacing(out.replace(/\s+/g, ' ').trim());
}

/** Insert a blank line where the vertical gap suggests a new block. */
function joinLines(lines: Line[]): string {
  const out: string[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const text = lineText(line);
    if (!text) continue;
    if (previous) {
      const gap = previous.y - line.y;
      const leading = Math.max(...line.items.map((i) => i.fontSize || 10));
      if (gap > leading * 1.8) out.push('');
    }
    out.push(text);
    previous = line;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function orderPage(items: StructuredTextItem[]): { text: string; columns: number } {
  if (items.length === 0) return { text: '', columns: 0 };

  const gutterX = findGutter(items);
  if (gutterX === null) return { text: joinLines(toLines(items)), columns: 1 };

  // Items that straddle the gutter (a full-width header) go with the column that
  // is read first, which keeps them at the top of the output where they belong.
  const left = items.filter((i) => i.x < gutterX);
  const right = items.filter((i) => i.x >= gutterX);
  const leftText = joinLines(toLines(left));
  const rightText = joinLines(toLines(right));
  return { text: `${leftText}\n\n${rightText}`.trim(), columns: 2 };
}

const VISION_PROMPT =
  'This image is one page of a CV. Transcribe every piece of text you can read, ' +
  'preserving the reading order a person would use and the section structure ' +
  '(name and contact details first, then each section under its own heading). ' +
  'Do not summarise, do not add commentary, do not invent anything that is not visible. ' +
  'Output plain text only.';

/** Rasterise a page and read it with the vision model. */
async function extractPageWithVision(data: Uint8Array, pageNumber: number): Promise<string> {
  // unpdf needs an explicit canvas implementation under Node; @napi-rs/canvas is
  // a devDependency because this path only ever runs during ingest.
  const png = await renderPageAsImage(data, pageNumber, {
    scale: 2,
    canvasImport: () => import('@napi-rs/canvas'),
  });
  const { text } = await generateText({
    model: textModel(),
    maxRetries: 3,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image', image: new Uint8Array(png), mediaType: 'image/png' },
        ],
      },
    ],
  });
  return text.trim();
}

export interface ExtractOptions {
  /** Set false to skip the vision model and leave image-only pages empty. */
  vision?: boolean;
}

export async function extractPdf(pdfPath: string, options: ExtractOptions = {}): Promise<ExtractedPdf> {
  const vision = options.vision ?? true;
  const buffer = await readFile(pdfPath);
  const data = new Uint8Array(buffer);

  // getDocumentProxy consumes the buffer it is given, so hand each reader its own.
  const proxy = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, items } = await extractTextItems(proxy);

  const pages: ExtractedPage[] = [];
  for (let index = 0; index < totalPages; index++) {
    const { text, columns } = orderPage(items[index] ?? []);
    if (text.length >= MIN_PAGE_CHARS) {
      pages.push({ page: index + 1, text, source: 'text', columns });
      continue;
    }
    if (!vision) {
      pages.push({ page: index + 1, text, source: 'empty', columns });
      continue;
    }
    const transcribed = await extractPageWithVision(new Uint8Array(data), index + 1);
    pages.push({ page: index + 1, text: transcribed, source: 'vision', columns: 1 });
  }

  return { numPages: totalPages, pages };
}
