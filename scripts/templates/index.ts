import type { CVProfile } from '../../lib/schemas';
import type { TemplateId } from '../lib/sampler';

/**
 * Three print templates (PRD §5.2). They exist to make ingest non-trivial:
 * `sidebar` is a genuine two-column layout, so naive PDF text extraction
 * interleaves the sidebar with the main column and produces nonsense. The
 * column-aware ordering in lib/ingest/extract.ts is written against these.
 */

const LABELS = {
  en: {
    summary: 'Profile',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    languages: 'Languages',
    contact: 'Contact',
    present: 'Present',
    yoe: (n: number) => `${n} years of experience`,
  },
  es: {
    summary: 'Perfil',
    experience: 'Experiencia',
    education: 'Formación',
    skills: 'Competencias',
    languages: 'Idiomas',
    contact: 'Contacto',
    present: 'Actualidad',
    yoe: (n: number) => `${n} años de experiencia`,
  },
} as const;

export type CVLanguage = keyof typeof LABELS;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateRange(start: string, end: string, lang: CVLanguage): string {
  const finish = /present|current|actual/i.test(end) ? LABELS[lang].present : end;
  return `${esc(start)} — ${esc(finish)}`;
}

function skillsByCategory(profile: CVProfile): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const skill of profile.skills) {
    const list = groups.get(skill.category) ?? [];
    list.push(skill.name);
    groups.set(skill.category, list);
  }
  return [...groups.entries()];
}

const BASE_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1c1f24;
    font-size: 10.2pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: 210mm; min-height: 297mm; }
  h1, h2, h3 { margin: 0; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; }
  a { color: inherit; text-decoration: none; }
  .role { margin-bottom: 11px; break-inside: avoid; }
  .role-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .role-title { font-weight: 600; }
  .role-dates { font-size: 8.6pt; color: #6b7280; white-space: nowrap; }
  .role-company { font-size: 9.4pt; color: #4b5563; margin-bottom: 3px; }
  .role-desc { font-size: 9.6pt; color: #303640; }
  .edu { margin-bottom: 9px; break-inside: avoid; }
  .edu-degree { font-weight: 600; }
  .edu-inst { font-size: 9.4pt; color: #4b5563; }
  .muted { color: #6b7280; }
`;

function experienceHtml(profile: CVProfile, lang: CVLanguage): string {
  return profile.experience
    .map(
      (role) => `
      <div class="role">
        <div class="role-head">
          <div class="role-title">${esc(role.title)}</div>
          <div class="role-dates">${dateRange(role.start_date, role.end_date, lang)}</div>
        </div>
        <div class="role-company">${esc(role.company)}</div>
        <div class="role-desc">${esc(role.description)}</div>
      </div>`,
    )
    .join('');
}

function educationHtml(profile: CVProfile): string {
  return profile.education
    .map(
      (edu) => `
      <div class="edu">
        <div class="edu-degree">${esc(edu.degree)} ${esc(edu.field)}<span class="role-dates"> · ${edu.end_year}</span></div>
        <div class="edu-inst">${esc(edu.institution)}</div>
      </div>`,
    )
    .join('');
}

function languagesHtml(profile: CVProfile): string {
  return profile.languages.map((l) => `<li>${esc(l.language)} <span class="muted">· ${esc(l.level)}</span></li>`).join('');
}

/* ------------------------------------------------------------- classic --- */

function classic(profile: CVProfile, photo: string, lang: CVLanguage): string {
  const t = LABELS[lang];
  return `
  <style>
    ${BASE_CSS}
    .page { padding: 18mm 20mm; }
    header { display: flex; gap: 18px; align-items: center; border-bottom: 2px solid #1c1f24; padding-bottom: 14px; }
    header img { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; }
    .name { font-size: 22pt; letter-spacing: -0.4px; }
    .headline { font-size: 11pt; color: #374151; margin-top: 2px; }
    .contact { font-size: 8.8pt; color: #6b7280; margin-top: 6px; }
    section { margin-top: 16px; }
    section h2 {
      font-size: 9pt; letter-spacing: 1.4px; text-transform: uppercase;
      color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 9px;
    }
    .skill-row { display: flex; gap: 8px; margin-bottom: 4px; font-size: 9.6pt; }
    .skill-cat { width: 96px; flex: none; color: #6b7280; }
    .langs { display: flex; gap: 18px; font-size: 9.6pt; }
  </style>
  <div class="page">
    <header>
      ${photo ? `<img src="${photo}" alt="">` : ''}
      <div>
        <h1 class="name">${esc(profile.name)}</h1>
        <div class="headline">${esc(profile.current_title)} · ${t.yoe(profile.years_experience)}</div>
        <div class="contact">${esc(profile.email)} · ${esc(profile.phone)} · ${esc(profile.location)}</div>
      </div>
    </header>
    <section><h2>${t.summary}</h2><p style="margin:0">${esc(profile.summary)}</p></section>
    <section><h2>${t.experience}</h2>${experienceHtml(profile, lang)}</section>
    <section><h2>${t.education}</h2>${educationHtml(profile)}</section>
    <section><h2>${t.skills}</h2>
      ${skillsByCategory(profile)
        .map(([cat, names]) => `<div class="skill-row"><div class="skill-cat">${esc(cat)}</div><div>${names.map(esc).join(' · ')}</div></div>`)
        .join('')}
    </section>
    <section><h2>${t.languages}</h2><ul class="langs">${languagesHtml(profile)}</ul></section>
  </div>`;
}

/* ------------------------------------------------------------- sidebar --- */

function sidebar(profile: CVProfile, photo: string, lang: CVLanguage): string {
  const t = LABELS[lang];
  return `
  <style>
    ${BASE_CSS}
    .page { display: flex; }
    aside {
      width: 62mm; flex: none; background: #1f2937; color: #e5e7eb;
      padding: 16mm 10mm; min-height: 297mm;
    }
    aside img { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 14px; border: 3px solid #374151; }
    aside h2 { font-size: 8.4pt; letter-spacing: 1.4px; text-transform: uppercase; color: #9ca3af; margin: 16px 0 7px; }
    aside .item { font-size: 9pt; margin-bottom: 4px; word-break: break-word; }
    aside .chip { display: inline-block; background: #374151; border-radius: 3px; padding: 2px 6px; margin: 0 3px 4px 0; font-size: 8.4pt; }
    main { padding: 16mm 12mm 16mm 11mm; }
    .name { font-size: 20pt; letter-spacing: -0.4px; }
    .headline { font-size: 10.6pt; color: #374151; margin: 2px 0 14px; }
    main h2 { font-size: 9pt; letter-spacing: 1.4px; text-transform: uppercase; color: #6b7280; margin: 15px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  </style>
  <div class="page">
    <aside>
      ${photo ? `<img src="${photo}" alt="">` : ''}
      <h2>${t.contact}</h2>
      <div class="item">${esc(profile.email)}</div>
      <div class="item">${esc(profile.phone)}</div>
      <div class="item">${esc(profile.location)}</div>
      <h2>${t.skills}</h2>
      <div>${profile.skills.map((s) => `<span class="chip">${esc(s.name)}</span>`).join('')}</div>
      <h2>${t.languages}</h2>
      ${profile.languages.map((l) => `<div class="item">${esc(l.language)} · ${esc(l.level)}</div>`).join('')}
      <h2>${t.education}</h2>
      ${profile.education
        .map((e) => `<div class="item" style="margin-bottom:8px">${esc(e.degree)} ${esc(e.field)}<br><span style="color:#9ca3af">${esc(e.institution)}, ${e.end_year}</span></div>`)
        .join('')}
    </aside>
    <main>
      <h1 class="name">${esc(profile.name)}</h1>
      <div class="headline">${esc(profile.current_title)} · ${t.yoe(profile.years_experience)}</div>
      <p style="margin:0">${esc(profile.summary)}</p>
      <h2>${t.experience}</h2>
      ${experienceHtml(profile, lang)}
    </main>
  </div>`;
}

/* -------------------------------------------------------------- modern --- */

function modern(profile: CVProfile, photo: string, lang: CVLanguage): string {
  const t = LABELS[lang];
  return `
  <style>
    ${BASE_CSS}
    .band { background: #0f766e; color: #ecfdf5; padding: 14mm 18mm 12mm; display: flex; gap: 20px; align-items: center; }
    .band img { width: 92px; height: 92px; border-radius: 12px; object-fit: cover; border: 2px solid rgba(255,255,255,.35); }
    .name { font-size: 23pt; letter-spacing: -0.5px; }
    .headline { font-size: 11pt; opacity: .92; margin-top: 3px; }
    .contact { font-size: 8.8pt; opacity: .8; margin-top: 7px; }
    .body { padding: 12mm 18mm; display: grid; grid-template-columns: 1fr 58mm; gap: 14mm; }
    h2 { font-size: 9pt; letter-spacing: 1.4px; text-transform: uppercase; color: #0f766e; margin: 0 0 8px; }
    section { margin-bottom: 15px; }
    .chip { display: inline-block; border: 1px solid #99f6e4; color: #115e59; background: #f0fdfa; border-radius: 999px; padding: 2px 8px; margin: 0 4px 5px 0; font-size: 8.6pt; }
  </style>
  <div class="page">
    <div class="band">
      ${photo ? `<img src="${photo}" alt="">` : ''}
      <div>
        <h1 class="name">${esc(profile.name)}</h1>
        <div class="headline">${esc(profile.current_title)} · ${t.yoe(profile.years_experience)}</div>
        <div class="contact">${esc(profile.email)} · ${esc(profile.phone)} · ${esc(profile.location)}</div>
      </div>
    </div>
    <div class="body">
      <div>
        <section><h2>${t.summary}</h2><p style="margin:0">${esc(profile.summary)}</p></section>
        <section><h2>${t.experience}</h2>${experienceHtml(profile, lang)}</section>
      </div>
      <div>
        <section><h2>${t.skills}</h2><div>${profile.skills.map((s) => `<span class="chip">${esc(s.name)}</span>`).join('')}</div></section>
        <section><h2>${t.education}</h2>${educationHtml(profile)}</section>
        <section><h2>${t.languages}</h2><ul>${languagesHtml(profile)}</ul></section>
      </div>
    </div>
  </div>`;
}

const TEMPLATES: Record<TemplateId, (p: CVProfile, photo: string, lang: CVLanguage) => string> = {
  classic,
  sidebar,
  modern,
};

/** Full standalone HTML document for one CV, ready for Playwright. */
export function renderCV(
  profile: CVProfile,
  options: { template: TemplateId; photoDataUri: string; language: CVLanguage },
): string {
  const body = TEMPLATES[options.template](profile, options.photoDataUri, options.language);
  return `<!doctype html><html lang="${options.language}"><head><meta charset="utf-8"><title>${esc(profile.name)} — CV</title></head><body>${body}</body></html>`;
}

/**
 * Deterministic fallback headshot: initials on a seeded duotone. Used when
 * image generation is unavailable, so the pipeline never blocks on billing.
 */
export function avatarSvg(id: string, name: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 42% 62%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 38) % 360} 38% 42%)"/>
    </linearGradient></defs>
    <rect width="256" height="256" fill="url(#g)"/>
    <text x="128" y="128" fill="#fff" fill-opacity=".92" font-family="Helvetica, Arial, sans-serif"
          font-size="96" font-weight="500" text-anchor="middle" dominant-baseline="central">${esc(initials)}</text>
  </svg>`;
}
