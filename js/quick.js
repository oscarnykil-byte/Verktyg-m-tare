// Snabbinmatning: tolkar en dikterad eller skriven rad, t.ex.
// "WC, fyra kvadrat, klinker, två toaletter", till svar på rummets frågor.
// Tolkningen är regelbaserad och görs på enheten, så den fungerar offline och följer mallen.
import { applyTypeDefaults, byRole, fieldsFor, formatValue, roomTemplateFields } from './template.js';
import { round, uid } from './util.js';

const NUMBER_WORDS = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv',
  'tretton', 'fjorton', 'femton', 'sexton', 'sjutton', 'arton', 'nitton', 'tjugo'];
const TIMES = new Set(['×', 'x', '*', 'gånger', 'ggr']);
const SQM = new Set(['kvm', 'kvadrat', 'kvadratmeter', 'm2', 'm²']);
const SAME = new Set(['likadana', 'likadant', 'lika', 'identiska']);
// Småord som inte ska redovisas som "tolkades inte".
const FILLER = new Set(['en', 'ett', 'och', 'samt', 'med', 'st', 'stycken', 'på', 'i', 'är', 'har', 'det', 'golv', 'golvet', 'rum', 'm', 'meter']);

const TOKEN = /\d+-[a-zåäöéü]+|\d+(?:[.,]\d+)?|m²|m2|[a-zåäöéü]+(?:-[a-zåäöéü0-9]+)*|[×*,.;]/gi;

/** Delar upp texten i ord och tal. Skiljetecken och "och" delar in den i led. */
function tokenize(text) {
  const tokens = [];
  let segment = 0;
  for (const m of String(text).matchAll(TOKEN)) {
    const raw = m[0];
    let t = raw.toLowerCase();
    if (/^[,.;]$/.test(t) || t === 'och' || t === 'samt') { segment++; continue; }
    let num = null;
    if (/^\d+(?:[.,]\d+)?$/.test(t)) num = Number(t.replace(',', '.'));
    else if (t === 'ett') num = 1;
    else if (NUMBER_WORDS.includes(t)) num = NUMBER_WORDS.indexOf(t);
    if (TIMES.has(t)) t = '×';
    else if (SQM.has(t)) t = 'kvm';
    else if (t === 'meter') t = 'm';
    tokens.push({ raw, t, num, segment, used: false });
  }
  return tokens;
}

/** Ord ur en rubrik eller ett alternativ, t.ex. "Plast / vinyl" -> [["plast"], ["vinyl"]]. */
function aliases(text) {
  return String(text).split('/').map((part) =>
    (part.toLowerCase().match(/[a-zåäöéü0-9]+(?:-[a-zåäöéü0-9]+)*/g) || [])).filter((a) => a.length);
}

/** Nyckelord för en fråga: egna nyckelord från mallen plus första ordet i varje del av rubriken. */
function fieldKeywords(field) {
  const own = String(field.keywords || '').split(',').flatMap((k) => aliases(k));
  const fromLabel = aliases(field.label).map((a) => [a[0]]).filter((a) => a[0].length >= 3);
  return [...own, ...fromLabel];
}

/**
 * Hur väl ett sagt ord stämmer med ett ord ur mallen, eller -1 om det inte stämmer.
 * Tål böjningar ("toaletten", "speglar") och sammansättningar med golv ("klinkergolv").
 */
function wordScore(word, target) {
  if (word === target) return 100;
  const stripped = word.replace(/golv(et)?$/, '');
  if (stripped.length >= 3 && stripped !== word) return Math.max(wordScore(stripped, target) - 1, -1);
  const diff = Math.abs(word.length - target.length);
  if (target.length >= 3 && word.startsWith(target) && diff <= 4) return 90 - diff;
  if (word.length >= 4 && target.startsWith(word) && diff <= 3) return 90 - diff;
  let p = 0;
  while (p < word.length && p < target.length && word[p] === target[p]) p++;
  if (p >= 4 && p >= Math.min(word.length, target.length) - 2 && diff <= 4) return 70 - diff;
  return -1;
}

/** Stämmer orden från position i med alla ord i alias? Ger poäng eller -1. */
function matchAt(tokens, i, alias) {
  let score = 0;
  for (let k = 0; k < alias.length; k++) {
    const tok = tokens[i + k];
    if (!tok || tok.used || tok.segment !== tokens[i].segment) return -1;
    // Tal i mallen ("2-luft") jämförs som de står, ord jämförs med tolerans.
    const s = tok.num != null && !/^\d/.test(alias[k]) ? -1 : wordScore(tok.t, alias[k]);
    if (s < 0) return -1;
    score += s;
  }
  return score + alias.length * 1000;
}

/** Alla träffar på något av frågans nyckelord, i den ordning de sägs. */
function findKeywords(tokens, keywords) {
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const alias of keywords) {
      if (matchAt(tokens, i, alias) >= 0) { hits.push({ start: i, end: i + alias.length - 1 }); break; }
    }
  }
  return hits;
}

const freeNumber = (tokens, i, segment) => {
  const tok = tokens[i];
  return tok && !tok.used && tok.num != null && tok.segment === segment ? tok : null;
};

/**
 * @param text   det säljaren sa eller skrev
 * @param fields rummets frågor ur mallen
 * @returns values: tolkade svar per fråga, count: antal likadana rum (eller null),
 *          rows: nya rader till upprepande frågor, rest: text som inte gick att tolka
 */
export function parseRoomText(text, fields) {
  const tokens = tokenize(text);
  const values = {};
  const rows = {};
  let count = null;
  const use = (...list) => list.forEach((tok) => { if (tok) tok.used = true; });

  // "m" efter ett tal är bara en enhet.
  tokens.forEach((tok, i) => { if (tok.t === 'm' && tokens[i - 1]?.num != null) tok.used = true; });
  const next = (i) => { let j = i + 1; while (tokens[j]?.t === 'm' && tokens[j].used) j++; return j; };

  // 1. Yta: "8 gånger 7,5" eller "12 kvm".
  const areaField = fields.find((f) => f.type === 'area');
  if (areaField) {
    for (let i = 0; i < tokens.length && !values[areaField.id]; i++) {
      const a = tokens[i];
      if (a.used || a.num == null) continue;
      const op = tokens[next(i)];
      const b = op?.t === '×' ? tokens[next(i) + 1] : null;
      if (b && b.num != null && !b.used) {
        values[areaField.id] = { l: a.num, w: b.num, a: round(a.num * b.num) };
        use(a, op, b);
        const unit = tokens[next(tokens.indexOf(b))];
        if (unit?.t === 'kvm') use(unit);
      } else if (op?.t === 'kvm') {
        values[areaField.id] = { l: null, w: null, a: a.num };
        use(a, op);
      }
    }
  }

  // 2. Antal likadana rum: "fem likadana".
  for (let i = 0; i < tokens.length && count == null; i++) {
    if (!SAME.has(tokens[i].t)) continue;
    let j = i - 1;
    while (tokens[j] && ['st', 'stycken'].includes(tokens[j].t)) j--;
    const n = freeNumber(tokens, j, tokens[i].segment);
    if (n && n.num >= 1) {
      count = Math.round(n.num);
      for (let k = j; k <= i; k++) use(tokens[k]);
      if (tokens[i + 1]?.t === 'rum') use(tokens[i + 1]);
    }
  }

  // 3. Textfält följt av ett tal: "plan 2".
  for (const f of fields.filter((x) => x.type === 'text')) {
    const hit = findKeywords(tokens, fieldKeywords(f))
      .find((x) => freeNumber(tokens, x.end + 1, tokens[x.start].segment));
    if (!hit) continue;
    const words = tokens.slice(hit.start, hit.end + 2).map((tok) => tok.raw).join(' ');
    values[f.id] = words[0].toUpperCase() + words.slice(1);
    use(...tokens.slice(hit.start, hit.end + 2));
  }

  // 4. Räknare, tal och upprepande rader: "två toaletter", "tvättställ 1", "tre fönster".
  for (const f of fields.filter((x) => ['counter', 'number', 'group'].includes(x.type))) {
    // Samma ord kan vara både lokaltyp och räknare ("dusch ... två duschar"): ta träffen som har ett tal intill.
    const numberBy = (x) => freeNumber(tokens, x.start - 1, tokens[x.start].segment) ||
      freeNumber(tokens, x.end + 1, tokens[x.start].segment);
    const hit = findKeywords(tokens, fieldKeywords(f)).find(numberBy);
    if (!hit) continue;
    const n = numberBy(hit);
    if (f.type === 'group') {
      const counter = f.subfields.find((s) => s.type === 'counter' || s.type === 'number');
      if (!counter) continue;
      rows[f.id] = [{ _id: uid(), [counter.id]: n.num }];
    } else {
      values[f.id] = f.type === 'counter' ? Math.max(0, Math.round(n.num)) : n.num;
    }
    use(n, ...tokens.slice(hit.start, hit.end + 1));
  }

  // 5. Alternativ: "klinker", "konferensrum". Bästa träffen per ord vinner, så att
  //    "kontorslandskap" inte blir "kontor". Andra frågor än lokaltyp och golvtyp
  //    kräver att frågan nämns intill ("möblering hög"), annars blir vanliga ord feltolkade.
  const choices = fields.filter((f) => f.type === 'choice' || f.type === 'multi');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].used) continue;
    let best = null;
    for (const f of choices) {
      if (f.type === 'choice' && values[f.id]) continue;
      for (const option of f.options) {
        if (option.toLowerCase() === 'annat') continue;
        for (const alias of aliases(option)) {
          const score = matchAt(tokens, i, alias);
          if (score < 0 || (best && best.score >= score)) continue;
          let keyword = null;
          if (!f.role) {
            const end = i + alias.length - 1;
            keyword = fieldKeywords(f).map((k) =>
              (matchAt(tokens, end + 1, k) >= 0 && { start: end + 1, len: k.length }) ||
              (i - k.length >= 0 && matchAt(tokens, i - k.length, k) >= 0 && { start: i - k.length, len: k.length }))
              .find(Boolean);
            if (!keyword) continue;
          }
          best = { score, f, option, len: alias.length, keyword };
        }
      }
    }
    if (!best) continue;
    if (best.f.type === 'multi') values[best.f.id] = [...new Set([...(values[best.f.id] || []), best.option])];
    else values[best.f.id] = best.option;
    use(...tokens.slice(i, i + best.len));
    if (best.keyword) use(...tokens.slice(best.keyword.start, best.keyword.start + best.keyword.len));
  }

  const rest = tokens.filter((tok) => !tok.used && !FILLER.has(tok.t)).map((tok) => tok.raw).join(' ');
  return { values, rows, count, rest };
}

/** Läsbar sammanfattning av vad som tolkades, i frågornas ordning. */
export function describeParsed(parsed, fields) {
  const items = [];
  for (const f of fields) {
    if (f.id in parsed.values) items.push(`${f.label}: ${formatValue(f, parsed.values[f.id])}`);
    if (f.id in parsed.rows) items.push(`${f.label}: ${formatValue(f, parsed.rows[f.id])}`);
  }
  if (parsed.count) items.push(`Antal likadana rum: ${parsed.count}`);
  return items;
}

/**
 * Tolkar texten och fyller i rummet. Lokaltypen sätts först, eftersom den avgör förvalen
 * och vilka frågor som gäller. Det säljaren sa går före förval.
 * @returns understood: vad som fylldes i, hidden: frågor som nämndes men inte gäller lokaltypen,
 *          rest: text som inte gick att tolka, typeName: rummets lokaltyp
 */
export function applyQuickText(visit, room, text) {
  const template = visit.template;
  const all = fieldsFor(template.roomFields, visit.objectTypeId);
  const parsed = parseRoomText(text, all);
  room.auto ||= {};

  const typeField = byRole(template, 'roomType');
  if (typeField && typeField.id in parsed.values) {
    room.values[typeField.id] = parsed.values[typeField.id];
    applyTypeDefaults(template, room);
  }
  const shown = new Set(roomTemplateFields(visit, room).map((f) => f.id));
  const hidden = [];
  for (const f of all) {
    if (!(f.id in parsed.values) && !(f.id in parsed.rows)) continue;
    if (!shown.has(f.id)) {
      hidden.push(f.label);
      delete parsed.values[f.id];
      delete parsed.rows[f.id];
    } else if (f.id in parsed.rows) {
      room.values[f.id] = [...(room.values[f.id] || []), ...parsed.rows[f.id]];
    } else {
      room.values[f.id] = parsed.values[f.id];
      delete room.auto[f.id];
    }
  }
  if (parsed.count) room.count = parsed.count;
  return {
    understood: describeParsed(parsed, all),
    hidden,
    rest: parsed.rest,
    typeName: (typeField && room.values[typeField.id]) || 'rummet',
  };
}
