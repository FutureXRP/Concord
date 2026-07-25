/**
 * Theological synonym map for query expansion (spec §8.1).
 * Deterministic — expansion is a table lookup, not an LLM call.
 */

const SYNONYMS: Record<string, string[]> = {
  justification: ["righteousness", "imputation", "reckoned righteous", "declared righteous", "dikaiosis"],
  sanctification: ["holiness", "theosis", "deification", "christian perfection", "entire sanctification"],
  eucharist: ["lord's supper", "communion", "mass", "divine liturgy", "breaking of bread", "real presence", "transubstantiation", "consubstantiation", "sacramental union", "memorial"],
  baptism: ["christening", "immersion", "paedobaptism", "credobaptism", "believer's baptism", "infant baptism", "regeneration"],
  trinity: ["triune", "godhead", "consubstantial", "homoousios", "three persons", "one essence"],
  incarnation: ["hypostatic union", "two natures", "word made flesh", "theanthropos", "kenosis"],
  atonement: ["propitiation", "expiation", "satisfaction", "penal substitution", "christus victor", "ransom", "reconciliation"],
  salvation: ["soteriology", "redemption", "regeneration", "conversion", "new birth", "born again"],
  grace: ["unmerited favor", "prevenient grace", "irresistible grace", "common grace", "sufficient grace", "efficacious grace"],
  predestination: ["election", "foreordination", "decree", "reprobation", "unconditional election"],
  "free will": ["libertarian freedom", "moral agency", "synergism", "monergism", "arminianism"],
  scripture: ["bible", "word of god", "canon", "inspiration", "inerrancy", "sola scriptura"],
  tradition: ["holy tradition", "sacred tradition", "deposit of faith", "magisterium", "rule of faith"],
  church: ["ecclesiology", "body of christ", "ekklesia", "visible church", "invisible church", "apostolic succession"],
  eschatology: ["last things", "second coming", "parousia", "millennium", "rapture", "resurrection of the dead", "final judgment"],
  hell: ["gehenna", "hades", "sheol", "eternal punishment", "annihilationism", "conditional immortality"],
  heaven: ["paradise", "beatific vision", "new creation", "new jerusalem", "world to come"],
  purgatory: ["intermediate state", "purification after death", "toll houses"],
  mary: ["theotokos", "mother of god", "blessed virgin", "immaculate conception", "assumption", "perpetual virginity"],
  saints: ["intercession of saints", "veneration", "dulia", "communion of saints"],
  priesthood: ["ordination", "holy orders", "presbyter", "clergy", "priesthood of all believers"],
  repentance: ["penance", "contrition", "confession", "metanoia", "absolution"],
  faith: ["belief", "trust", "fiducia", "assent", "faith alone", "sola fide"],
  works: ["good works", "merit", "obedience", "law", "covenant faithfulness"],
  covenant: ["testament", "covenant theology", "dispensation", "federal headship"],
  "holy spirit": ["paraclete", "pneumatology", "spirit of god", "filioque", "procession"],
  "spiritual gifts": ["charismata", "tongues", "glossolalia", "prophecy", "cessationism", "continuationism"],
  worship: ["liturgy", "regulative principle", "normative principle", "icons", "iconography", "veneration of icons"],
  sabbath: ["lord's day", "sunday observance", "seventh day", "rest"],
  messiah: ["christ", "anointed one", "mashiach", "son of david"],
  torah: ["law of moses", "pentateuch", "chumash", "five books"],
  godhead: ["nature of god", "divine essence", "attributes of god", "monotheism", "tawhid"],
};

/**
 * Expand a query with mapped synonyms. Returns the original query plus a
 * bounded set of expansion terms for sparse/dense retrieval.
 */
export function expandQuery(query: string): { query: string; expansions: string[] } {
  const lower = query.toLowerCase();
  const expansions = new Set<string>();
  for (const [term, syns] of Object.entries(SYNONYMS)) {
    if (lower.includes(term)) {
      for (const s of syns) expansions.add(s);
    } else if (syns.some((s) => lower.includes(s))) {
      expansions.add(term);
      for (const s of syns) if (!lower.includes(s)) expansions.add(s);
    }
  }
  return { query, expansions: [...expansions].slice(0, 24) };
}
