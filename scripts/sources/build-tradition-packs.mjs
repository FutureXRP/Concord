// Fetches public-domain texts (Project Gutenberg via GITenberg mirrors) and
// parses them into Concord corpus works+chunks, merged into
// data/sources/confessions-corpus.json. Re-runnable; provenance lives here.
//
//   node scripts/sources/build-tradition-packs.mjs
//
// After running, sync the browser copy:
//   cp data/sources/confessions-corpus.json public/corpus/
import fs from "node:fs";
import path from "node:path";

const CORPUS = path.join(process.cwd(), "data/sources/confessions-corpus.json");

const SOURCES = {
  "baltimore2.txt":
    "https://raw.githubusercontent.com/GITenberg/A-Catechism-of-Christian-Doctrine_14552/master/14552.txt",
  "small-catechism.txt":
    "https://raw.githubusercontent.com/GITenberg/Luther-s-Little-Instruction-Book--The-Small-Catechism-of-Martin-Luther_1670/master/1670.txt",
  "augustine-confessions.txt":
    "https://raw.githubusercontent.com/GITenberg/The-Confessions-of-St.-Augustine_3296/master/3296.txt",
  "augsburg.txt":
    "https://raw.githubusercontent.com/GITenberg/The-Augsburg-Confession--13-The-confession-of-faith-which-was-submitted-to-His-Imperial-Majesty__275/master/275.txt",
  "bcp.txt":
    "https://raw.githubusercontent.com/GITenberg/The-Book-of-Common-Prayerand-The-Scottish-Liturgy_29622/master/29622.txt",
};

const cache = {};
for (const [name, url] of Object.entries(SOURCES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  cache[name] = await res.text();
  console.log(`fetched ${name} (${cache[name].length} bytes)`);
}
const T = (f) => cache[f];

const stripGutenberg = (s) => {
  let t = s.replace(/\r/g, "");
  const start = t.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/);
  if (start !== -1) t = t.slice(t.indexOf("\n", start) + 1);
  const end = t.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG|End of (the )?Project Gutenberg/);
  if (end !== -1) t = t.slice(0, end);
  return t;
};

const para = (s) => s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

const works = [];
const chunks = [];
const push = (work_id, locator, body) => {
  const text = body.trim();
  if (!text) return;
  chunks.push({ csid: `${work_id}:${locator}`, work_id, locator, body: text });
};

// ---------- Baltimore Catechism No. 2 (Gutenberg 14552) ----------
{
  const workId = "confession:baltimore-2";
  works.push({
    id: workId, title: "Baltimore Catechism No. 2", author: "Third Plenary Council of Baltimore",
    author_died_year: null, composed_year: 1885, composed_era: "modern", tradition: "catholic-roman",
    language_original: "en", translator: null, license_tier: "A",
    license_note: "Public domain. Project Gutenberg #14552 via GITenberg.",
    source_url: "https://github.com/GITenberg/A-Catechism-of-Christian-Doctrine_14552",
    embeddable: true, authority_class: "magisterial",
  });
  const t = stripGutenberg(T("baltimore2.txt"));
  // "1. Q. Who made the world?" ... "A. God made the world."
  const re = /^(\d{1,3})\. Q\. ([\s\S]*?)\nA\. ([\s\S]*?)(?=\n\d{1,3}\. Q\. |\nLESSON |\n\n\n)/gm;
  let m, count = 0;
  while ((m = re.exec(t)) !== null) {
    const q = m[2].replace(/\s+/g, " ").trim();
    const a = m[3].replace(/\s+/g, " ").trim();
    push(workId, `q${m[1]}`, `Q${m[1]}. ${q}\nA. ${a}`);
    count++;
  }
  console.log("baltimore-2:", count, "questions");
  if (count < 400) throw new Error("Baltimore parse under 400 questions");
}

// ---------- Augsburg Confession (Gutenberg 275, 1921 Triglot tr.) ----------
{
  const workId = "confession:augsburg";
  works.push({
    id: workId, title: "Augsburg Confession", author: "Philip Melanchthon",
    author_died_year: 1560, composed_year: 1530, composed_era: "reformation", tradition: "lutheran",
    language_original: "la", translator: "F. Bente and W. H. T. Dau (Triglot Concordia, 1921)",
    license_tier: "A", license_note: "Public domain. Project Gutenberg #275 via GITenberg.",
    source_url: "https://github.com/GITenberg/The-Augsburg-Confession--13-The-confession-of-faith-which-was-submitted-to-His-Imperial-Majesty__275",
    embeddable: true, authority_class: "confessional-standard",
  });
  const t = stripGutenberg(T("augsburg.txt"));
  const ROMAN = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10, XI:11, XII:12, XIII:13, XIV:14, XV:15, XVI:16, XVII:17, XVIII:18, XIX:19, XX:20, XXI:21, XXII:22, XXIII:23, XXIV:24, XXV:25, XXVI:26, XXVII:27, XXVIII:28 };
  const parts = t.split(/^Article ([IVX]+)(?::| -) ?([^\n]*)$/m);
  // parts: [pre, roman, title, body, roman, title, body, ...]
  let count = 0;
  for (let i = 1; i + 2 < parts.length + 1 && parts[i]; i += 3) {
    const n = ROMAN[parts[i]];
    if (!n) continue;
    const title = (parts[i + 1] ?? "").trim().replace(/\.$/, "");
    // Body runs to the next Article heading; cut trailing "Conclusion"-ish content on the last one.
    let body = (parts[i + 2] ?? "").trim();
    body = body.split(/\n(?:PART SECOND|CONCLUSION OF PART ONE)\b/)[0].trim();
    const paras = para(body).join("\n\n");
    push(workId, `art${n}`, `Article ${parts[i]}. ${title}.\n${paras}`);
    count++;
  }
  console.log("augsburg:", count, "articles");
  if (count < 28) throw new Error("Augsburg parse under 28 articles");
}

// ---------- Luther's Small Catechism (Gutenberg 1670, tr. R. E. Smith) ----------
{
  const workId = "confession:luther-small-catechism";
  works.push({
    id: workId, title: "Luther's Small Catechism", author: "Martin Luther",
    author_died_year: 1546, composed_year: 1529, composed_era: "reformation", tradition: "lutheran",
    language_original: "de", translator: "Robert E. Smith (1994, released for free distribution)",
    license_tier: "B", license_note: "Freely distributable translation. Project Gutenberg #1670 via GITenberg.",
    source_url: "https://github.com/GITenberg/Luther-s-Little-Instruction-Book--The-Small-Catechism-of-Martin-Luther_1670",
    embeddable: true, authority_class: "confessional-standard",
  });
  const t = stripGutenberg(T("small-catechism.txt"));
  const HEADING = /^(The (?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth) (?:Commandment|Article|Request)|The Conclusion to the Commandments|Introduction|Conclusion|[IVX]+\. The (?:Ten Commandments|Creed|Our Father|Sacrament of Holy Baptism|Sacrament of the Altar)|V\. Confession[^\n]*|What is Baptism\?|What is the Sacrament of the Altar\?|How can water do such great things\?|What good does Baptism do\?|Who receives this Sacrament in a worthy way\?|Appendix I+\b[^\n]*|The Blessing|The Home Chart)\s*$/;
  const lines = t.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (HEADING.test(trimmed)) {
      if (current) sections.push(current);
      current = { heading: trimmed, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  let n = 0;
  for (const s of sections) {
    const body = para(s.body.join("\n")).join("\n\n");
    if (!body) continue;
    n++;
    push(workId, `s${n}`, `${s.heading}\n${body}`);
  }
  console.log("small-catechism:", n, "sections");
  if (n < 20) throw new Error("Small Catechism parse under 20 sections");
}

// ---------- Thirty-Nine Articles (from BCP+Scottish Liturgy, Gutenberg 29622) ----------
{
  const workId = "confession:thirty-nine-articles";
  works.push({
    id: workId, title: "Thirty-Nine Articles of Religion", author: "Church of England",
    author_died_year: null, composed_year: 1571, composed_era: "reformation", tradition: "anglican",
    language_original: "en", translator: null, license_tier: "A",
    license_note: "Public domain. From The Book of Common Prayer and the Scottish Liturgy, Project Gutenberg #29622 via GITenberg.",
    source_url: "https://github.com/GITenberg/The-Book-of-Common-Prayerand-The-Scottish-Liturgy_29622",
    embeddable: true, authority_class: "confessional-standard",
  });
  const t = stripGutenberg(T("bcp.txt"));
  const bodyStart = t.indexOf("I. _Of Faith in the Holy Trinity_");
  if (bodyStart === -1) throw new Error("39 Articles body not found");
  const region = t.slice(bodyStart);
  // Titles may wrap: "XXIV. _Of speaking in the Congregation in such a tongue as the" / "people understandeth_."
  const ROMAN_START = /^([IVXL]+)\. _(.*)$/;
  const toInt = (r) => { const map = { I:1,V:5,X:10,L:50 }; let v=0; for (let i=0;i<r.length;i++){const c=map[r[i]],nx=map[r[i+1]]??0; v += c<nx?-c:c;} return v; };
  const lines = region.split("\n");
  const arts = [];
  let cur = null;
  let inTitle = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(ROMAN_START);
    if (m && toInt(m[1]) >= 1 && toInt(m[1]) <= 39) {
      if (cur) arts.push(cur);
      if (toInt(m[1]) === 1 && arts.length > 0) break; // wrapped around
      cur = { n: toInt(m[1]), title: m[2], body: [] };
      inTitle = !/_\.?\s*$/.test(m[2]);
      cur.title = cur.title.replace(/_\.?\s*$/, "");
    } else if (cur && inTitle) {
      cur.title += " " + trimmed.replace(/_\.?\s*$/, "");
      if (/_\.?\s*$/.test(trimmed)) inTitle = false;
    } else if (cur) {
      if (/^_?The Ratification/.test(trimmed) || /^APPENDIX|^TABLES/.test(trimmed)) { arts.push(cur); cur = null; break; }
      cur.body.push(line);
    }
  }
  if (cur) arts.push(cur);
  for (const a of arts) a.title = a.title.replace(/_/g, "").trim();
  let count = 0;
  for (const a of arts) {
    const body = para(a.body.join("\n")).join("\n\n");
    if (!body) continue;
    push(workId, `art${a.n}`, `Article ${a.n}. Of ${a.title.replace(/^Of /, "")}.\n${body}`);
    count++;
  }
  console.log("39-articles:", count, "articles");
  if (count < 39) throw new Error(`39 Articles parse got ${count}`);
}

// ---------- Augustine, Confessions (Gutenberg 3296, Pusey tr.) ----------
{
  const workId = "father:augustine:confessions";
  works.push({
    id: workId, title: "Confessions", author: "Augustine of Hippo",
    author_died_year: 430, composed_year: 400, composed_era: "post-nicene", tradition: "patristic-undivided",
    language_original: "la", translator: "E. B. Pusey", license_tier: "A",
    license_note: "Public domain. Project Gutenberg #3296 via GITenberg.",
    source_url: "https://github.com/GITenberg/The-Confessions-of-St.-Augustine_3296",
    embeddable: true, authority_class: "authoritative-teacher",
  });
  const t = stripGutenberg(T("augustine-confessions.txt"));
  const books = t.split(/^BOOK ([IVX]+)\s*$/m);
  const ROMAN = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10, XI:11, XII:12, XIII:13 };
  let count = 0;
  for (let i = 1; i + 1 < books.length; i += 2) {
    const bookNum = ROMAN[books[i]];
    if (!bookNum) continue;
    const paras = para(books[i + 1]);
    paras.forEach((p, j) => {
      if (p.length < 40) return; // skip stray fragments
      push(workId, `${bookNum}.${j + 1}`, p);
      count++;
    });
  }
  console.log("augustine confessions:", count, "paragraphs");
  if (count < 300) throw new Error("Augustine parse under 300 paragraphs");
}

// ---------- Merge into corpus ----------
const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
const newWorkIds = new Set(works.map((w) => w.id));
corpus.works = [...corpus.works.filter((w) => !newWorkIds.has(w.id)), ...works];
corpus.chunks = [...corpus.chunks.filter((c) => !newWorkIds.has(c.work_id)), ...chunks];
fs.writeFileSync(CORPUS, JSON.stringify(corpus, null, 1));
console.log(`corpus now: ${corpus.works.length} works, ${corpus.chunks.length} chunks`);
