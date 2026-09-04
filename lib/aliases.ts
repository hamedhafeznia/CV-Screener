/**
 * Hand-written alias map for the institutions and skills this corpus actually
 * contains (PRD §6.1).
 *
 * This is deliberately not an open-ended entity-linking problem: we generate the
 * CVs, so the set of universities and skills that can appear is closed and small.
 * Both ingest and query time run strings through the same normalizer, which is
 * what makes `institution:"UPC"` match "Universitat Politècnica de Catalunya".
 */

/** canonical form -> surface forms that must resolve to it */
const INSTITUTION_ALIASES: Record<string, string[]> = {
  'universitat politecnica de catalunya': ['upc', 'upc barcelonatech', 'barcelonatech', 'politecnica de catalunya'],
  'universitat pompeu fabra': ['upf', 'pompeu fabra'],
  'universitat de barcelona': ['ub', 'university of barcelona'],
  'universidad politecnica de madrid': ['upm', 'politecnica de madrid'],
  'universidad autonoma de madrid': ['uam', 'autonoma de madrid'],
  'massachusetts institute of technology': ['mit'],
  'technical university of munich': ['tum', 'technische universitat munchen', 'tu munich', 'tu munchen'],
  'delft university of technology': ['tu delft', 'tud', 'technische universiteit delft'],
  'imperial college london': ['imperial college', 'imperial'],
  'ecole polytechnique federale de lausanne': ['epfl'],
  'kth royal institute of technology': ['kth', 'kungliga tekniska hogskolan'],
  'politecnico di milano': ['polimi', 'milan polytechnic'],
  'universidade de sao paulo': ['usp', 'university of sao paulo'],
  'indian institute of technology bombay': ['iit bombay', 'iitb', 'iit-b'],
  'university of edinburgh': ['edinburgh', 'uoe'],
  'trinity college dublin': ['tcd', 'trinity college', 'trinity dublin'],
  'universidad de buenos aires': ['uba', 'university of buenos aires'],
  'instituto superior tecnico': ['ist', 'ist lisbon', 'tecnico lisboa'],
  'aalto university': ['aalto'],
  'university of warsaw': ['uw warsaw', 'uniwersytet warszawski'],
  'bogazici university': ['bogazici', 'bosphorus university'],
  'university of cape town': ['uct'],
  'universitat potsdam': ['potsdam', 'university of potsdam', 'uni potsdam'],
  'university of amsterdam': ['uva', 'universiteit van amsterdam'],
};

/** canonical form -> surface forms that must resolve to it */
const SKILL_ALIASES: Record<string, string[]> = {
  python: ['py', 'python3'],
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  'node.js': ['node', 'nodejs', 'node js'],
  postgresql: ['postgres', 'psql', 'postgre sql'],
  mysql: ['my sql'],
  mongodb: ['mongo'],
  elasticsearch: ['elastic search', 'elastic', 'opensearch'],
  kubernetes: ['k8s', 'kube'],
  docker: ['containers', 'containerization'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  'microsoft azure': ['azure'],
  terraform: ['hashicorp terraform'],
  'ci/cd': ['cicd', 'continuous integration', 'continuous delivery', 'github actions', 'gitlab ci', 'jenkins'],
  react: ['react.js', 'reactjs', 'react js'],
  'next.js': ['next', 'nextjs'],
  'vue.js': ['vue', 'vuejs'],
  go: ['golang'],
  rust: [],
  java: [],
  'c#': ['csharp', 'c sharp', '.net', 'dotnet'],
  'c++': ['cpp', 'cplusplus'],
  sql: [],
  'scikit-learn': ['sklearn', 'scikit learn'],
  pytorch: ['torch'],
  tensorflow: ['tf keras', 'keras'],
  'machine learning': ['ml'],
  'deep learning': ['dl', 'neural networks'],
  'natural language processing': ['nlp'],
  'computer vision': ['cv vision', 'opencv'],
  'apache spark': ['spark', 'pyspark'],
  airflow: ['apache airflow'],
  dbt: ['data build tool'],
  kafka: ['apache kafka'],
  graphql: ['graph ql'],
  rest: ['rest api', 'restful', 'rest apis'],
  grpc: ['g rpc'],
  figma: [],
  'user research': ['ux research'],
  'design systems': ['design system'],
  playwright: [],
  cypress: [],
  selenium: [],
  jira: ['atlassian jira'],
  tableau: [],
  'power bi': ['powerbi'],
  snowflake: [],
  redis: [],
  rabbitmq: ['rabbit mq'],
  linux: ['unix'],
  git: [],
};

/**
 * Casefold, strip diacritics, drop punctuation, collapse whitespace.
 * "Universitat Politècnica de Catalunya" -> "universitat politecnica de catalunya"
 */
export function baseNormalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[().,;:\/\\'"`’]/g, ' ')
    .replace(/[^a-z0-9+#.\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLookup(map: Record<string, string[]>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(map)) {
    lookup.set(baseNormalize(canonical), canonical);
    for (const alias of aliases) lookup.set(baseNormalize(alias), canonical);
  }
  return lookup;
}

const INSTITUTION_LOOKUP = buildLookup(INSTITUTION_ALIASES);
const SKILL_LOOKUP = buildLookup(SKILL_ALIASES);

function resolve(raw: string, lookup: Map<string, string>): string {
  const base = baseNormalize(raw);
  if (!base) return base;

  const direct = lookup.get(base);
  if (direct) return direct;

  // "Universitat Politècnica de Catalunya (UPC)" — try the part before the paren
  // and the acronym inside it, in that order.
  const withoutTrailingAcronym = base.replace(/\s+[a-z0-9\-]{2,12}$/, '').trim();
  const trimmed = lookup.get(withoutTrailingAcronym);
  if (trimmed) return trimmed;

  // Last resort: a known canonical contained in, or containing, the input.
  // Guarded by length so "go" or "ts" cannot swallow unrelated strings.
  if (base.length >= 4) {
    for (const [surface, canonical] of lookup) {
      if (surface.length >= 4 && (base.includes(surface) || surface.includes(base))) {
        return canonical;
      }
    }
  }
  return base;
}

/** Canonical institution key. Falls back to the base-normalized input. */
export function normalizeInstitution(raw: string): string {
  return resolve(raw, INSTITUTION_LOOKUP);
}

/** Canonical skill key. Falls back to the base-normalized input. */
export function normalizeSkill(raw: string): string {
  return resolve(raw, SKILL_LOOKUP);
}

/**
 * Every surface form of an institution, for stuffing into the embedded chunk
 * text so vector search sees the acronym too.
 */
export function institutionSurfaceForms(raw: string): string[] {
  const canonical = normalizeInstitution(raw);
  const aliases = INSTITUTION_ALIASES[canonical] ?? [];
  return [...new Set([raw, ...aliases.map((a) => a.toUpperCase())])];
}

export function skillSurfaceForms(raw: string): string[] {
  const canonical = normalizeSkill(raw);
  const aliases = SKILL_ALIASES[canonical] ?? [];
  return [...new Set([raw, ...aliases])];
}

export const KNOWN_INSTITUTIONS = Object.keys(INSTITUTION_ALIASES);
export const KNOWN_SKILLS = Object.keys(SKILL_ALIASES);
