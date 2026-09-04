/**
 * Seeded CV spec sampler (PRD §5.1).
 *
 * Asking an LLM for "30 realistic CVs" returns 30 interchangeable mid-level
 * backend engineers. Diversity is a code problem, not a prompting problem: this
 * file draws the *axes* of each CV — role, seniority, geography, university,
 * employers, language, template — from curated pools with a fixed seed, and the
 * model only writes prose inside those constraints.
 *
 * Deterministic: two runs with the same seed produce byte-identical specs.
 */

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead' | 'principal';
export type TemplateId = 'classic' | 'sidebar' | 'modern';

export interface CVSpec {
  id: string;
  name: string;
  role_key: string;
  role_title: string;
  seniority: Seniority;
  years: number;
  city: string;
  university: string;
  degree_field: string;
  degree_level: string;
  languages: { language: string; level: string }[];
  skills_bias: string[];
  companies: string[];
  template_id: TemplateId;
  photo_hint: string;
  /** Language the CV prose is written in. */
  cv_language: 'en' | 'es';
  /** Render the PDF as a flattened image so it carries no extractable text. */
  flatten_to_image: boolean;
  num_roles: number;
}

/* ------------------------------------------------------------------ rng --- */

/** mulberry32 — small, fast, deterministic. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float() {
    return this.next();
  }
  int(minInclusive: number, maxInclusive: number) {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  /** Fisher–Yates, non-mutating. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  /** `count` distinct members of `items`. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.min(count, items.length));
  }
  bool(pTrue: number) {
    return this.next() < pTrue;
  }
}

/* ---------------------------------------------------------------- pools --- */

interface Role {
  key: string;
  titles: Record<Seniority, string>;
  core: string[];
  optional: string[];
  /** Probability this role's holder writes Python on their CV. */
  python: number;
}

const ROLES: Role[] = [
  {
    key: 'backend',
    titles: {
      junior: 'Junior Backend Engineer',
      mid: 'Backend Engineer',
      senior: 'Senior Backend Engineer',
      lead: 'Backend Tech Lead',
      principal: 'Principal Backend Engineer',
    },
    core: ['PostgreSQL', 'REST', 'Docker', 'Git'],
    optional: ['Go', 'Java', 'Redis', 'Kafka', 'gRPC', 'Kubernetes', 'RabbitMQ', 'Elasticsearch'],
    python: 0.55,
  },
  {
    key: 'frontend',
    titles: {
      junior: 'Junior Frontend Engineer',
      mid: 'Frontend Engineer',
      senior: 'Senior Frontend Engineer',
      lead: 'Frontend Tech Lead',
      principal: 'Principal Frontend Engineer',
    },
    core: ['TypeScript', 'React', 'JavaScript', 'Git'],
    optional: ['Next.js', 'Vue.js', 'GraphQL', 'Cypress', 'Playwright', 'Design Systems'],
    python: 0.05,
  },
  {
    key: 'fullstack',
    titles: {
      junior: 'Junior Full-Stack Engineer',
      mid: 'Full-Stack Engineer',
      senior: 'Senior Full-Stack Engineer',
      lead: 'Full-Stack Tech Lead',
      principal: 'Principal Full-Stack Engineer',
    },
    core: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
    optional: ['Next.js', 'GraphQL', 'Docker', 'AWS', 'Redis'],
    python: 0.35,
  },
  {
    key: 'data-eng',
    titles: {
      junior: 'Junior Data Engineer',
      mid: 'Data Engineer',
      senior: 'Senior Data Engineer',
      lead: 'Data Engineering Lead',
      principal: 'Principal Data Engineer',
    },
    core: ['Python', 'SQL', 'Apache Spark', 'Airflow'],
    optional: ['dbt', 'Snowflake', 'Kafka', 'GCP', 'AWS', 'Terraform'],
    python: 1,
  },
  {
    key: 'ml',
    titles: {
      junior: 'Junior Machine Learning Engineer',
      mid: 'Machine Learning Engineer',
      senior: 'Senior Machine Learning Engineer',
      lead: 'ML Engineering Lead',
      principal: 'Principal Machine Learning Engineer',
    },
    core: ['Python', 'PyTorch', 'Machine Learning', 'Docker'],
    optional: ['TensorFlow', 'NLP', 'Computer Vision', 'Deep Learning', 'Kubernetes', 'GCP'],
    python: 1,
  },
  {
    key: 'data-sci',
    titles: {
      junior: 'Junior Data Scientist',
      mid: 'Data Scientist',
      senior: 'Senior Data Scientist',
      lead: 'Lead Data Scientist',
      principal: 'Principal Data Scientist',
    },
    core: ['Python', 'SQL', 'scikit-learn', 'Machine Learning'],
    optional: ['Tableau', 'Power BI', 'Snowflake', 'Apache Spark', 'Deep Learning'],
    python: 1,
  },
  {
    key: 'devops',
    titles: {
      junior: 'Junior Platform Engineer',
      mid: 'DevOps Engineer',
      senior: 'Senior Platform Engineer',
      lead: 'Platform Engineering Lead',
      principal: 'Principal Infrastructure Engineer',
    },
    core: ['Kubernetes', 'Terraform', 'Docker', 'Linux'],
    optional: ['AWS', 'GCP', 'Azure', 'CI/CD', 'Go', 'Prometheus'],
    python: 0.6,
  },
  {
    key: 'mobile',
    titles: {
      junior: 'Junior Mobile Engineer',
      mid: 'Mobile Engineer',
      senior: 'Senior Mobile Engineer',
      lead: 'Mobile Tech Lead',
      principal: 'Principal Mobile Engineer',
    },
    core: ['Swift', 'Kotlin', 'Git'],
    optional: ['React Native', 'CI/CD', 'GraphQL', 'REST'],
    python: 0.05,
  },
  {
    key: 'qa',
    titles: {
      junior: 'Junior QA Engineer',
      mid: 'QA Automation Engineer',
      senior: 'Senior QA Automation Engineer',
      lead: 'QA Lead',
      principal: 'Principal Test Engineer',
    },
    core: ['Selenium', 'CI/CD', 'Git'],
    optional: ['Playwright', 'Cypress', 'Java', 'TypeScript', 'Jira'],
    python: 0.6,
  },
  {
    key: 'security',
    titles: {
      junior: 'Junior Security Engineer',
      mid: 'Security Engineer',
      senior: 'Senior Security Engineer',
      lead: 'Security Engineering Lead',
      principal: 'Principal Security Engineer',
    },
    core: ['Linux', 'Docker', 'CI/CD'],
    optional: ['Kubernetes', 'AWS', 'Terraform', 'Go'],
    python: 0.7,
  },
  {
    key: 'pm',
    titles: {
      junior: 'Associate Product Manager',
      mid: 'Product Manager',
      senior: 'Senior Product Manager',
      lead: 'Group Product Manager',
      principal: 'Principal Product Manager',
    },
    core: ['Jira', 'User Research', 'SQL'],
    optional: ['Tableau', 'Figma', 'Power BI'],
    python: 0.1,
  },
  {
    key: 'design',
    titles: {
      junior: 'Junior Product Designer',
      mid: 'Product Designer',
      senior: 'Senior Product Designer',
      lead: 'Design Lead',
      principal: 'Principal Product Designer',
    },
    core: ['Figma', 'Design Systems', 'User Research'],
    optional: ['Prototyping', 'Accessibility', 'Illustration'],
    python: 0,
  },
];

interface Region {
  key: string;
  cities: string[];
  universities: string[];
  companies: string[];
  firstNames: string[];
  lastNames: string[];
  nativeLanguage: string;
}

/**
 * No FAANG employer appears anywhere in the corpus. That is deliberate: the eval
 * harness asks "who worked at Google?" as a negative case, and the answer has to
 * be a defensible "nobody".
 */
const REGIONS: Region[] = [
  {
    key: 'es',
    cities: ['Barcelona, Spain', 'Madrid, Spain', 'Valencia, Spain'],
    universities: [
      'Universitat Politècnica de Catalunya',
      'Universitat Pompeu Fabra',
      'Universitat de Barcelona',
      'Universidad Politécnica de Madrid',
      'Universidad Autónoma de Madrid',
    ],
    companies: ['Glovo', 'Typeform', 'Factorial', 'Wallapop', 'TravelPerk', 'Cabify', 'Adevinta', 'SEAT:CODE', 'Red Points'],
    firstNames: ['Marta', 'Jordi', 'Núria', 'Álvaro', 'Carla', 'Sergio', 'Laia', 'Pablo', 'Irene', 'Xavier'],
    lastNames: ['Serrano', 'Puig', 'Vidal', 'Ferrer', 'Molina', 'Bosch', 'Navarro', 'Ibáñez', 'Solé', 'Prieto'],
    nativeLanguage: 'Spanish',
  },
  {
    key: 'de',
    cities: ['Berlin, Germany', 'Munich, Germany'],
    universities: ['Technical University of Munich', 'Universität Potsdam'],
    companies: ['Zalando', 'Delivery Hero', 'N26', 'SoundCloud', 'Personio', 'HelloFresh'],
    firstNames: ['Lena', 'Jonas', 'Katharina', 'Felix', 'Anja', 'Tobias'],
    lastNames: ['Brandt', 'Keller', 'Hoffmann', 'Neumann', 'Roth', 'Schuster'],
    nativeLanguage: 'German',
  },
  {
    key: 'nl',
    cities: ['Amsterdam, Netherlands'],
    universities: ['Delft University of Technology', 'University of Amsterdam'],
    companies: ['Booking.com', 'Adyen', 'Mollie', 'Picnic', 'Bunq'],
    firstNames: ['Sanne', 'Daan', 'Femke', 'Bram'],
    lastNames: ['Visser', 'de Vries', 'Bakker', 'Jansen'],
    nativeLanguage: 'Dutch',
  },
  {
    key: 'uk-ie',
    cities: ['London, United Kingdom', 'Edinburgh, United Kingdom', 'Dublin, Ireland'],
    universities: ['Imperial College London', 'University of Edinburgh', 'Trinity College Dublin'],
    companies: ['Monzo', 'Revolut', 'Deliveroo', 'Intercom', 'Wise', 'Ocado Technology'],
    firstNames: ['Aoife', 'Callum', 'Priya', 'Owen', 'Hannah', 'Declan'],
    lastNames: ['Whelan', 'Mackenzie', 'Sharma', 'Doyle', 'Ashworth', 'Byrne'],
    nativeLanguage: 'English',
  },
  {
    key: 'nordic',
    cities: ['Stockholm, Sweden', 'Helsinki, Finland'],
    universities: ['KTH Royal Institute of Technology', 'Aalto University'],
    companies: ['Klarna', 'Spotify', 'Wolt', 'Supercell', 'Tink'],
    firstNames: ['Elin', 'Mikael', 'Aino', 'Oskar'],
    lastNames: ['Lindqvist', 'Åberg', 'Virtanen', 'Sandberg'],
    nativeLanguage: 'Swedish',
  },
  {
    key: 'south-eu',
    cities: ['Milan, Italy', 'Lisbon, Portugal', 'Istanbul, Türkiye'],
    universities: ['Politecnico di Milano', 'Instituto Superior Técnico', 'Boğaziçi University'],
    companies: ['Satispay', 'Feedzai', 'Unbabel', 'Getir', 'Trendyol'],
    firstNames: ['Giulia', 'Matteo', 'Rita', 'Tomás', 'Deniz', 'Elif'],
    lastNames: ['Ferrari', 'Ricci', 'Almeida', 'Carvalho', 'Yılmaz', 'Demir'],
    nativeLanguage: 'Italian',
  },
  {
    key: 'latam',
    cities: ['São Paulo, Brazil', 'Buenos Aires, Argentina'],
    universities: ['Universidade de São Paulo', 'Universidad de Buenos Aires'],
    companies: ['Nubank', 'Mercado Libre', 'iFood', 'Rappi', 'Ualá'],
    firstNames: ['Beatriz', 'Rodrigo', 'Camila', 'Nicolás'],
    lastNames: ['Moreira', 'Barbosa', 'Quiroga', 'Ferreyra'],
    nativeLanguage: 'Portuguese',
  },
  {
    key: 'other',
    cities: ['Bangalore, India', 'Warsaw, Poland', 'Cape Town, South Africa', 'Zurich, Switzerland'],
    universities: [
      'Indian Institute of Technology Bombay',
      'University of Warsaw',
      'University of Cape Town',
      'École Polytechnique Fédérale de Lausanne',
    ],
    companies: ['Zomato', 'Razorpay', 'Allegro', 'DocPlanner', 'Yoco', 'Nexthink'],
    firstNames: ['Ananya', 'Rohit', 'Zofia', 'Marek', 'Thandi', 'Sipho'],
    lastNames: ['Iyer', 'Chandra', 'Kowalczyk', 'Wójcik', 'Ndlovu', 'Mokoena'],
    nativeLanguage: 'Hindi',
  },
];

const DEGREE_FIELDS = [
  'Computer Science',
  'Software Engineering',
  'Telecommunications Engineering',
  'Data Science',
  'Applied Mathematics',
  'Industrial Engineering',
  'Information Systems',
  'Interaction Design',
  'Business Analytics',
  'Electrical Engineering',
];

const PHOTO_HINTS = [
  'warm smile, navy blazer, plain light-grey studio backdrop',
  'neutral expression, charcoal knit sweater, soft office bokeh background',
  'friendly half-smile, white shirt, bright neutral wall',
  'confident look, olive jacket over t-shirt, muted teal backdrop',
  'relaxed smile, denim shirt, soft daylight from the left',
  'composed expression, burgundy blouse, warm beige backdrop',
  'slight smile, black turtleneck, deep grey gradient backdrop',
  'open smile, light-blue oxford shirt, out-of-focus greenery',
];

const SENIORITY_YEARS: Record<Seniority, [number, number]> = {
  junior: [1, 3],
  mid: [3, 6],
  senior: [6, 10],
  lead: [9, 14],
  principal: [12, 20],
};

const SENIORITY_WEIGHTS: [Seniority, number][] = [
  ['junior', 4],
  ['mid', 8],
  ['senior', 10],
  ['lead', 5],
  ['principal', 3],
];

/* --------------------------------------------------------------- sample --- */

export const DEFAULT_SEED = 20260904;
export const DEFAULT_COUNT = 30;

function weightedSeniority(rng: Rng): Seniority {
  const total = SENIORITY_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let roll = rng.float() * total;
  for (const [value, weight] of SENIORITY_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return 'mid';
}

export function sampleSpecs(count = DEFAULT_COUNT, seed = DEFAULT_SEED): CVSpec[] {
  const rng = new Rng(seed);

  // Round-robin the roles so every one is represented before any repeats, then
  // shuffle so role doesn't correlate with id.
  const roleCycle: Role[] = [];
  while (roleCycle.length < count) roleCycle.push(ROLES[roleCycle.length % ROLES.length]);
  const roles = rng.shuffle(roleCycle);

  // Same trick for regions, weighted towards Spain (the corpus is Barcelona-centric,
  // which is what makes the "UPC" question a realistic one to ask).
  const regionCycle: Region[] = [];
  const regionBag = [...REGIONS, REGIONS[0], REGIONS[0], REGIONS[3]];
  while (regionCycle.length < count) regionCycle.push(regionBag[regionCycle.length % regionBag.length]);
  const regions = rng.shuffle(regionCycle);

  const usedNames = new Set<string>();
  const specs: CVSpec[] = [];

  for (let i = 0; i < count; i++) {
    const role = roles[i];
    const region = regions[i];
    const seniority = weightedSeniority(rng);
    const [minYears, maxYears] = SENIORITY_YEARS[seniority];

    let name = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      name = `${rng.pick(region.firstNames)} ${rng.pick(region.lastNames)}`;
      if (!usedNames.has(name)) break;
    }
    usedNames.add(name);

    const wantsPython = rng.bool(role.python);
    const skills = [
      ...role.core,
      ...rng.sample(role.optional, rng.int(2, 4)),
      ...(wantsPython && !role.core.includes('Python') ? ['Python'] : []),
    ];

    const languages: { language: string; level: string }[] = [
      { language: 'English', level: region.nativeLanguage === 'English' ? 'Native' : rng.pick(['C1', 'C2', 'Fluent']) },
    ];
    if (region.nativeLanguage !== 'English') {
      languages.unshift({ language: region.nativeLanguage, level: 'Native' });
    }
    if (rng.bool(0.35)) {
      const extra = rng.pick(['French', 'German', 'Portuguese', 'Catalan', 'Italian']);
      if (!languages.some((l) => l.language === extra)) {
        languages.push({ language: extra, level: rng.pick(['B1', 'B2', 'Conversational']) });
      }
    }

    specs.push({
      id: `cv_${String(i + 1).padStart(3, '0')}`,
      name,
      role_key: role.key,
      role_title: role.titles[seniority],
      seniority,
      years: rng.int(minYears, maxYears),
      city: rng.pick(region.cities),
      university: rng.pick(region.universities),
      degree_field: rng.pick(DEGREE_FIELDS),
      degree_level: seniority === 'junior' ? rng.pick(['BSc', 'BSc', 'MSc']) : rng.pick(['BSc', 'MSc', 'MSc', 'PhD']),
      languages,
      skills_bias: [...new Set(skills)],
      companies: rng.sample(region.companies, Math.min(4, region.companies.length)),
      template_id: rng.pick<TemplateId>(['classic', 'sidebar', 'modern']),
      photo_hint: rng.pick(PHOTO_HINTS),
      cv_language: 'en',
      flatten_to_image: false,
      num_roles: seniority === 'junior' ? rng.int(1, 2) : seniority === 'mid' ? rng.int(2, 3) : rng.int(3, 4),
    });
  }

  return applyHardCases(specs, new Rng(seed ^ 0x5eed));
}

/**
 * PRD §5.3 — deliberate hard cases, plus the two guarantees the grader's own
 * questions depend on. Applied as a post-pass so the base distribution above
 * stays readable, and so each guarantee is enforced rather than hoped for.
 */
function applyHardCases(specs: CVSpec[], rng: Rng): CVSpec[] {
  const out = specs.map((s) => ({ ...s }));
  const UPC = 'Universitat Politècnica de Catalunya';

  // (1) Exactly one UPC graduate, so "which candidate graduated from UPC?" has a
  //     single correct answer. Any incidental UPC draws are moved to UPF.
  const upcIndices = out.map((s, i) => (s.university === UPC ? i : -1)).filter((i) => i >= 0);
  const keep = upcIndices.length > 0 ? upcIndices[0] : out.findIndex((s) => s.city.startsWith('Barcelona'));
  const upcIndex = keep >= 0 ? keep : 0;
  for (const i of upcIndices) if (i !== upcIndex) out[i].university = 'Universitat Pompeu Fabra';
  out[upcIndex].university = UPC;
  if (!out[upcIndex].city.startsWith('Barcelona')) out[upcIndex].city = 'Barcelona, Spain';

  // (2) At least three CVs on the two-column template, whose naive text extraction
  //     interleaves the columns.
  const sidebarCount = out.filter((s) => s.template_id === 'sidebar').length;
  for (let i = 0; i < out.length && out.filter((s) => s.template_id === 'sidebar').length < 3; i++) {
    if (out[i].template_id !== 'sidebar') out[i].template_id = 'sidebar';
  }
  void sidebarCount;

  // (3) Two Spanish-language CVs, drawn from Spain-based candidates.
  const spanish = out
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.city.endsWith('Spain') && s.id !== out[upcIndex].id)
    .map(({ i }) => i);
  for (const i of rng.sample(spanish, 2)) out[i].cv_language = 'es';

  // (4) Exactly one CV flattened to an image, forcing the vision fallback at
  //     ingest. Never the UPC candidate — the acronym question should not
  //     depend on OCR.
  const flattenPool = out.map((s, i) => i).filter((i) => i !== upcIndex && out[i].cv_language === 'en');
  out[rng.pick(flattenPool)].flatten_to_image = true;

  return out;
}
