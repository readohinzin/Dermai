'use strict';
/* SAFE-FETCH : récupération contrôlée d'UNE page Web publique. Outillage hors navigateur ; jamais chargé par l'application ni par le moteur.
   Ce module ne DÉCOUVRE aucune URL, n'extrait rien (extractors.js) et n'écrit nulle part : il reçoit une URL, renvoie un résultat structuré explicable.

   CE QUI EST GARANTI (chaque point a un test, avec transport et DNS simulés) :
     1. URL : protocole autorisé (https seulement), port autorisé (443 seulement), pas d'identifiants, pas de barre oblique inverse ni de caractère de contrôle, pas d'adresse IP en clair
        (les notations ambiguës 2130706433, 0x7f.1, 127.1... sont normalisées par l'analyseur WHATWG puis refusées), pas de nom local (localhost, .local, .internal, nom sans point).
     2. DNS : l'hôte est résolu UNE fois par étape ; TOUTES les adresses renvoyées doivent être publiques (liste d'exclusion IPv4 et liste d'autorisation IPv6 globale-unicast) ; une réponse
        mixte (publique + privée) est refusée en entier.
     3. Connexion ÉPINGLÉE : la connexion est ouverte vers l'adresse DÉJÀ validée (pas vers le nom), avec le nom d'hôte pour SNI et vérification du certificat. Aucune seconde résolution n'a lieu :
        un changement de réponse DNS entre validation et connexion (DNS rebinding) ne peut pas rediriger la connexion. L'adresse réellement connectée (socket) est comparée à l'adresse validée ;
        si le transport ne la rapporte pas, le résultat est un échec (échec fermé).
     4. Redirections : jamais suivies automatiquement ; chaque destination repasse par 1, 2 et 3 ; nombre limité ; boucle refusée ; URL initiale et finale conservées.
     5. Limites : délai TOTAL, nombre de redirections, taille du corps (compressée ET décompressée, comptée au fil de l'eau, jamais chargée avant contrôle), types de contenu autorisés,
        encodages gérés (gzip, deflate, br), statut HTTP. Toutes centralisées dans LIMITS et POLICY.
     6. Jamais de fausse réussite : tout échec renvoie ok: false, un motif stable (FAILURES) et aucun corps.

   CE QUI N'EST PAS GARANTI (voir README, « Limites ») : le transport par défaut (node:https) n'a PAS été exercé sur un vrai réseau pendant le développement (interdit) ; la connexion épinglée avec SNI
   repose sur le comportement documenté de Node et doit être confirmée par un premier essai réel autorisé. Aucun support de proxy (échec fermé derrière un proxy de sortie obligatoire). robots.txt et
   conditions d'utilisation des sites ne sont pas traités ici (décision de la phase de découverte). */
const net = require('node:net');
const dns = require('node:dns');
const https = require('node:https');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');

const SCHEMA = 'safe-fetch/1';

/* Valeurs numériques centralisées (surchargeables à la baisse ou à la hausse par opts.limits, jamais ailleurs dans le code). */
const LIMITS = Object.freeze({
  timeoutMs: 10000,              // délai TOTAL de l'appel, redirections comprises
  socketTimeoutMs: 8000,         // inactivité d'une connexion
  maxRedirects: 5,
  maxRawBytes: 2 * 1024 * 1024,  // octets reçus sur le fil (après découpage de transfert, avant décompression)
  maxBodyBytes: 2 * 1024 * 1024, // octets après décompression
  maxUrlLength: 2048,
  maxAddresses: 16,              // nombre d'adresses DNS examinées ; au-delà : refus
  maxAddressAttempts: 3          // adresses essayées, toutes déjà validées, en cas d'échec de connexion
});
/* Politique fixe : non surchargeable (la sécurité ne se règle pas par option). */
const POLICY = Object.freeze({
  allowedProtocols: Object.freeze(['https:']),
  allowedPorts: Object.freeze([443]),
  allowedContentTypes: Object.freeze(['text/html', 'application/xhtml+xml', 'application/json', 'application/ld+json']),
  redirectStatuses: Object.freeze([301, 302, 303, 307, 308]),
  acceptEncoding: 'gzip, deflate, br',
  userAgent: 'DermaiMarketCheck/1.0',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.1'
});

const FAILURES = Object.freeze({
  invalid_input: 'entrée invalide : une adresse textuelle est attendue',
  malformed_url: 'adresse malformée', url_too_long: 'adresse trop longue', url_forbidden_characters: 'caractères interdits dans l\'adresse (contrôle, espace, barre oblique inverse)',
  protocol_not_allowed: 'protocole non autorisé', credentials_not_allowed: 'identifiants intégrés à l\'adresse', port_not_allowed: 'port non autorisé',
  ip_literal_not_allowed: 'adresse IP en clair non autorisée', hostname_not_public: 'nom d\'hôte non public (local, interne ou sans domaine)', hostname_invalid: 'nom d\'hôte invalide',
  dns_not_found: 'nom d\'hôte introuvable', dns_error: 'erreur de résolution DNS', dns_no_address: 'résolution DNS sans adresse', dns_too_many_addresses: 'résolution DNS : trop d\'adresses',
  dns_forbidden_address: 'résolution DNS vers une adresse interdite (privée, locale ou réservée)', dns_mixed_addresses: 'résolution DNS mixte (adresses publiques et interdites) : refusée en entier',
  connection_error: 'erreur de connexion', connection_address_mismatch: 'l\'adresse connectée diffère de l\'adresse validée', connection_address_unverified: 'l\'adresse connectée n\'a pas pu être vérifiée',
  tls_error: 'erreur TLS (certificat ou protocole)', timeout: 'délai dépassé',
  redirect_without_location: 'redirection sans destination', redirect_invalid_location: 'destination de redirection invalide', redirect_loop: 'boucle de redirection', too_many_redirects: 'trop de redirections',
  http_error_status: 'réponse HTTP en erreur', http_unexpected_status: 'statut HTTP inattendu', http_invalid_response: 'réponse HTTP invalide',
  content_type_missing: 'type de contenu absent', content_type_not_allowed: 'type de contenu non autorisé', content_encoding_not_supported: 'encodage de contenu non pris en charge',
  body_too_large: 'corps trop volumineux', body_incomplete: 'corps incomplet (connexion interrompue)', body_decode_error: 'corps illisible (décompression)', body_stream_error: 'erreur de lecture du corps',
  internal_error: 'erreur interne'
});

class FetchError extends Error {
  constructor(code, detail) { super(FAILURES[code] || code); this.code = code; this.detail = detail === undefined ? null : detail; }
}

/* ---------------------------------------------------------------- adresses IP */
/* POLITIQUE D'ADRESSES : des tables de données (plus aucune cascade de conditions) et un seul algorithme de comparaison de préfixes.
   IPv4 et IPv6 « usage spécial » : tables V4_SPECIAL et V6_SPECIAL, reprises de mémoire des registres IANA des adresses à usage spécial.
   IPv6 « allouées » : REFUS PAR DÉFAUT. Une adresse de 2000::/3 n'est acceptée que si elle appartient à un bloc listé dans V6_ALLOCATED ; le reste de 2000::/3 est réservé par l'IANA pour des allocations
   futures (registre « IPv6 Global Unicast Address Assignments ») et n'est pas routable sur Internet : il est refusé (motif ipv6_unallocated), y compris 2000::/8, 3000::/4 hors documentation et 3ffe::/16.
   LIMITE ASSUMÉE ET DOCUMENTÉE : la liste des allocations n'est PAS dans le dépôt et aucune ressource externe n'a été consultée. V6_ALLOCATED est donc une liste MINIMALE, écrite de mémoire (blocs entièrement
   délégués à un registre Internet régional, d'une ancienneté et d'une stabilité qui rendent l'erreur improbable), VOLONTAIREMENT INCOMPLÈTE et NON VÉRIFIÉE (V6_ALLOCATED_STATUS) : elle ne prétend pas être exhaustive.
   Conséquence : une adresse IPv6 réellement publique mais hors de ces blocs est refusée (échec sûr). Pour la prendre en charge, remplacer le contenu de V6_ALLOCATED par les blocs du registre officiel
   (procédure dans le README) ; aucun autre code ne change. */
function parseIPv4(s) {
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(s);          // aucun zéro initial : « 012.0.0.1 » est octal pour certains lecteurs
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some(x => x > 255) ? null : o;
}
const v4int = o => (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;

/* IPv6 → 8 groupes de 16 bits, ou null. Refuse l'identifiant de zone (%). Accepte un suffixe IPv4 en notation pointée. */
function parseIPv6(s) {
  if (typeof s !== 'string' || s.includes('%') || !net.isIPv6(s)) return null;
  let head = s, tail4 = null;
  const lastColon = s.lastIndexOf(':'), dotted = s.slice(lastColon + 1);
  if (dotted.includes('.')) { const o = parseIPv4(dotted); if (!o) return null; tail4 = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]]; head = s.slice(0, lastColon + 1) + '0:0'; }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const toGroups = part => (part === '' ? [] : part.split(':').map(g => parseInt(g, 16)));
  const left = toGroups(halves[0]), right = halves.length === 2 ? toGroups(halves[1]) : [];
  let groups;
  if (halves.length === 2) { const fill = 8 - left.length - right.length; if (fill < 1) return null; groups = left.concat(Array(fill).fill(0), right); } else groups = left;
  if (groups.length !== 8 || groups.some(g => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  if (tail4) { groups[6] = tail4[0]; groups[7] = tail4[1]; }
  return groups;
}
const ipKey = a => { const g = parseIPv6(a); if (g) return '6:' + g.join(':'); const o = parseIPv4(a); return o ? '4:' + o.join('.') : null; };

/* [préfixe, longueur en bits, motif]. Le premier préfixe qui correspond donne le motif. Tout motif est un refus. */
const V4_SPECIAL = Object.freeze([
  ['0.0.0.0', 8, 'unspecified'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'carrier_grade_nat'], ['127.0.0.0', 8, 'loopback'], ['169.254.0.0', 16, 'link_local'], ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'], ['192.0.2.0', 24, 'documentation'], ['192.31.196.0', 24, 'reserved'], ['192.52.193.0', 24, 'reserved'], ['192.88.99.0', 24, 'reserved'], ['192.168.0.0', 16, 'private'],
  ['192.175.48.0', 24, 'reserved'], ['198.18.0.0', 15, 'benchmarking'], ['198.51.100.0', 24, 'documentation'], ['203.0.113.0', 24, 'documentation'], ['224.0.0.0', 4, 'multicast'], ['240.0.0.0', 4, 'reserved']
].map(r => Object.freeze({ prefix: r[0], bits: r[1], reason: r[2] })));
/* IPv6 : liste d'AUTORISATION 2000::/3 (monodiffusion globale) moins les préfixes à usage spécial ci-dessous ; toute adresse hors de 2000::/3 est refusée (motif par défaut ipv6_not_global_unicast). */
const V6_GLOBAL = Object.freeze({ prefix: '2000::', bits: 3 });
const V6_SPECIAL = Object.freeze([
  ['::', 128, 'unspecified'], ['::1', 128, 'loopback'], ['::', 96, 'ipv6_embedded_ipv4'], ['::ffff:0:0', 96, 'ipv6_embedded_ipv4'], ['64:ff9b::', 32, 'ipv6_embedded_ipv4'],
  ['100::', 64, 'ipv6_not_global_unicast'], ['fc00::', 7, 'private'], ['fe80::', 10, 'link_local'], ['fec0::', 10, 'ipv6_not_global_unicast'], ['ff00::', 8, 'multicast'],
  ['2001::', 23, 'reserved'], ['2001:db8::', 32, 'documentation'], ['2002::', 16, 'ipv6_embedded_ipv4'], ['2620:4f:8000::', 48, 'reserved'], ['3fff::', 20, 'documentation'], ['5f00::', 16, 'ipv6_not_global_unicast']
].map(r => Object.freeze({ prefix: r[0], bits: r[1], reason: r[2] })));
/* Blocs IPv6 global-unicast DÉLÉGUÉS par l'IANA à un registre Internet régional (blocs entiers). Liste minimale, non exhaustive, non vérifiée contre le registre officiel. */
const V6_ALLOCATED = Object.freeze([
  ['2003::', 18, 'RIPE NCC'], ['2400::', 12, 'APNIC'], ['2600::', 12, 'ARIN'], ['2610::', 23, 'ARIN'], ['2620::', 23, 'ARIN'], ['2800::', 12, 'LACNIC'], ['2a00::', 12, 'RIPE NCC'], ['2c00::', 12, 'AFRINIC']
].map(r => Object.freeze({ prefix: r[0], bits: r[1], holder: r[2] })));
const V6_ALLOCATED_STATUS = Object.freeze({
  exhaustive: false, verifiedAgainstRegistry: false, defaultDecision: 'refuse',
  basis: 'mémoire des délégations IANA aux registres Internet régionaux ; registre officiel non consulté',
  registry: 'https://www.iana.org/assignments/ipv6-unicast-address-assignments', specialRegistry: 'https://www.iana.org/assignments/iana-ipv6-special-registry'
});
const v4Rules = V4_SPECIAL.map(r => ({ start: v4int(parseIPv4(r.prefix)), bits: r.bits, reason: r.reason }));
const v6Rules = V6_SPECIAL.map(r => ({ groups: parseIPv6(r.prefix), bits: r.bits, reason: r.reason }));
const v6Allocated = V6_ALLOCATED.map(r => ({ groups: parseIPv6(r.prefix), bits: r.bits }));
const v6Global = { groups: parseIPv6(V6_GLOBAL.prefix), bits: V6_GLOBAL.bits };
const v6Match = (g, rule) => { let left = rule.bits; for (let i = 0; i < 8 && left > 0; i++, left -= 16) { const n = Math.min(16, left), mask = (0xffff << (16 - n)) & 0xffff; if ((g[i] & mask) !== (rule.groups[i] & mask)) return false; } return true; };

/* classifyIp(adresse) → { address, family, public, reason, kind }. kind : 'public' | 'special' (usage spécial, privée, locale, documentation, transition, encapsulée : dangereuse) | 'unverified' (global-unicast
   hors des blocs alloués connus : refusée par défaut, non dangereuse en soi) | 'invalid'. En cas de doute : non publique. */
function classifyIp(address) {
  const no = (family, reason, kind) => ({ address, family, public: false, reason, kind: kind || 'special' });
  if (typeof address !== 'string' || net.isIP(address) === 0) return no(0, 'invalid_address', 'invalid');          // forme canonique exigée : ce que Node connecte est ce que l'on a classé
  const o = parseIPv4(address);
  if (o) {
    const n = v4int(o);
    for (const r of v4Rules) if (((n ^ r.start) >>> (32 - r.bits)) === 0) return no(4, r.reason);
    return { address, family: 4, public: true, reason: null, kind: 'public' };
  }
  const g = parseIPv6(address);
  if (!g) return no(0, 'invalid_address', 'invalid');
  for (const r of v6Rules) if (v6Match(g, r)) return no(6, r.reason);
  if (!v6Match(g, v6Global)) return no(6, 'ipv6_not_global_unicast');
  if (!v6Allocated.some(r => v6Match(g, r))) return no(6, 'ipv6_unallocated', 'unverified');                          // réservé pour de futures allocations (ou non vérifié) : refusé par défaut
  return { address, family: 6, public: true, reason: null, kind: 'public' };
}

/* ---------------------------------------------------------------- URL */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.intranet', '.lan'];
/* validateUrl(texte) → { ok: true, url, href, hostname, port } | { ok: false, code }. Pure : aucune résolution. */
function validateUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, code: 'invalid_input' };
  const raw = input;                                                                   // aucune normalisation silencieuse : espaces et retours à la ligne autour de l'adresse sont refusés ci-dessous
  if (raw.length > LIMITS.maxUrlLength) return { ok: false, code: 'url_too_long' };
  if (/[\u0000- \u007f\\]/.test(raw)) return { ok: false, code: 'url_forbidden_characters' };
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, code: 'malformed_url' }; }
  if (!POLICY.allowedProtocols.includes(u.protocol)) return { ok: false, code: 'protocol_not_allowed' };
  if (u.username || u.password) return { ok: false, code: 'credentials_not_allowed' };
  const port = u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : Number(u.port);
  if (!POLICY.allowedPorts.includes(port)) return { ok: false, code: 'port_not_allowed' };
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') || net.isIP(host) !== 0) return { ok: false, code: 'ip_literal_not_allowed' };
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253 || host.split('.').some(l => !l || l.length > 63)) return { ok: false, code: 'hostname_invalid' };
  if (net.isIP(host) !== 0) return { ok: false, code: 'ip_literal_not_allowed' };
  if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) return { ok: false, code: 'hostname_not_public' };
  u.hash = '';
  return { ok: true, url: u, href: u.href, hostname: host, port };
}

/* ---------------------------------------------------------------- DNS */
const defaultResolve = async hostname => (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map(r => ({ address: r.address, family: r.family }));

/* Résout puis valide TOUTES les adresses. Renvoie { addresses, ignored } ou lève FetchError.
   - une adresse DANGEREUSE (usage spécial, privée, locale...) parmi les réponses : réponse mixte refusée en entier, ou refus total si aucune n'est publique ;
   - une adresse IPv6 NON ALLOUÉE ou non vérifiée (kind 'unverified') n'est jamais utilisée : ignorée si une adresse publique existe (le site reste joignable en IPv4 ou par une IPv6 connue), sinon refus. */
async function resolveValidated(hostname, resolve, limits) {
  let list;
  try { list = await resolve(hostname); } catch (e) { throw new FetchError(e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA') ? 'dns_not_found' : 'dns_error', e && e.code ? String(e.code) : null); }
  if (!Array.isArray(list) || !list.length) throw new FetchError('dns_no_address');
  if (list.length > limits.maxAddresses) throw new FetchError('dns_too_many_addresses', list.length);
  const checked = list.map(r => classifyIp(r && r.address));
  const pub = checked.filter(c => c.public), refused = checked.filter(c => !c.public), dangerous = refused.filter(c => c.kind !== 'unverified');
  const describe = c => ({ address: c.address, reason: c.reason });
  if (!pub.length) throw new FetchError('dns_forbidden_address', refused.map(describe));
  if (dangerous.length) throw new FetchError('dns_mixed_addresses', { forbidden: refused.map(describe), public: pub.map(c => c.address) });
  const seen = new Set(), addresses = [];
  for (const c of pub) if (!seen.has(ipKey(c.address))) { seen.add(ipKey(c.address)); addresses.push({ address: c.address, family: c.family }); }
  return { addresses, ignored: refused.map(describe) };
}

/* ---------------------------------------------------------------- transport */
/* Transport par défaut : node:https, connexion directe vers l'adresse validée (host = adresse), SNI et vérification du certificat sur le NOM, Host explicite, agent jetable (aucune connexion réutilisée),
   TLS 1.2 minimum. N'utilise ni fetch, ni proxy, ni résolution de nom. Contrat du transport (aussi celui des transports simulés) :
   request({ hostname, address, family, port, path, headers, socketTimeoutMs }) → Promise<{ statusCode, headers (minuscules), body (flux ou itérable de Buffer), remoteAddress, abort() }>. */
function buildRequestOptions(o) {
  return { host: o.address, family: o.family, port: o.port, method: 'GET', path: o.path, servername: o.hostname, setHost: false, agent: false, minVersion: 'TLSv1.2',
    headers: Object.assign({ Host: o.port === 443 ? o.hostname : o.hostname + ':' + o.port }, o.headers) };
}
function defaultRequest(o) {
  return new Promise((resolve, reject) => {
    const req = https.request(buildRequestOptions(o), res => resolve({ statusCode: res.statusCode, headers: res.headers, body: res, remoteAddress: res.socket && res.socket.remoteAddress, abort: () => req.destroy() }));
    req.setTimeout(o.socketTimeoutMs, () => req.destroy(Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/* ---------------------------------------------------------------- lecture du corps */
const DECODERS = { gzip: () => zlib.createGunzip(), 'x-gzip': () => zlib.createGunzip(), deflate: () => zlib.createInflate(), br: () => zlib.createBrotliDecompress() };

function readBody(res, limits, encoding) {
  return new Promise((resolve, reject) => {
    const src = typeof res.body.on === 'function' ? res.body : Readable.from(res.body);
    const decoder = encoding ? DECODERS[encoding]() : null;
    const chunks = [];
    let rawBytes = 0, bytes = 0, finished = false, srcEnded = false;
    const stop = () => { try { src.destroy(); } catch (e) { /* déjà fermé */ } try { if (decoder) decoder.destroy(); } catch (e) { /* idem */ } try { if (res.abort) res.abort(); } catch (e) { /* idem */ } };
    const fail = (code, detail) => { if (finished) return; finished = true; stop(); reject(new FetchError(code, detail)); };
    const done = () => { if (finished) return; finished = true; resolve({ buffer: Buffer.concat(chunks), rawBytes, bytes }); };
    src.on('data', c => { rawBytes += c.length; if (rawBytes > limits.maxRawBytes) fail('body_too_large', { limit: 'raw' }); });
    src.on('error', () => fail('body_stream_error'));
    src.on('end', () => { srcEnded = true; });
    src.on('close', () => { if (!srcEnded) fail('body_incomplete'); });
    const sink = decoder || src;
    if (decoder) { decoder.on('error', () => fail('body_decode_error')); src.pipe(decoder); }
    sink.on('data', c => { bytes += c.length; if (bytes > limits.maxBodyBytes) return fail('body_too_large', { limit: 'decoded' }); chunks.push(c); });
    sink.on('end', done);
    res.__stop = stop;
  });
}

function parseContentType(h) {
  if (typeof h !== 'string' || !h.trim()) return null;
  const parts = h.split(';').map(s => s.trim());
  const cs = parts.slice(1).map(p => /^charset\s*=\s*"?([^";]+)"?$/i.exec(p)).find(Boolean);
  return { mime: parts[0].toLowerCase(), charset: cs ? cs[1].trim().toLowerCase() : null };
}

/* ---------------------------------------------------------------- appel principal */
const clean = r => JSON.parse(JSON.stringify(r));

/* fetchPage(url, { limits, deps: { resolve, request, now } }) → résultat structuré. Ne lève jamais d'exception. */
async function fetchPage(input, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const limits = Object.assign({}, LIMITS, o.limits || {});
  const deps = Object.assign({ resolve: defaultResolve, request: defaultRequest, now: () => Date.now() }, o.deps || {});
  const t0 = deps.now();
  const result = { schema: SCHEMA, ok: false, requestedUrl: typeof input === 'string' ? input : null, finalUrl: null, status: null, contentType: null, charset: null, rawBytes: 0, bytes: 0, body: null,
    redirects: [], trace: [], failure: null, warnings: [], elapsedMs: 0 };
  let timer = null, over = false, hopNo = 0, current = typeof input === 'string' ? input : null;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new FetchError('timeout')), limits.timeoutMs); });
  deadline.catch(() => { /* consommé par la course ci-dessous */ });
  const guard = p => Promise.race([p, deadline]);
  const fail = (e, hop) => {
    const code = e instanceof FetchError ? e.code : 'internal_error';
    result.ok = false; result.body = null;
    result.failure = { code, message: FAILURES[code] || FAILURES.internal_error, hop: hop === undefined ? hopNo : hop, phase: (hop === undefined ? hopNo : hop) > 0 ? 'redirect' : 'initial', url: current, detail: e instanceof FetchError ? e.detail : null };
  };
  try {
    const first = validateUrl(input);
    if (!first.ok) { fail(new FetchError(first.code), 0); return clean(finish(result, t0, deps)); }
    let v = first;
    const visited = new Set();
    for (let hop = 0; ; hop++) {
      hopNo = hop; current = v.href;
      if (visited.has(v.href)) throw new FetchError('redirect_loop');
      visited.add(v.href);
      const resolved = await guard(resolveValidated(v.hostname, deps.resolve, limits)), addresses = resolved.addresses;
      if (resolved.ignored.length && !result.warnings.includes('dns_unverified_addresses_ignored')) result.warnings.push('dns_unverified_addresses_ignored');
      let res = null, used = null, lastErr = null;
      for (const a of addresses.slice(0, limits.maxAddressAttempts)) {
        try {
          const pending = deps.request({ hostname: v.hostname, address: a.address, family: a.family, port: v.port, path: v.url.pathname + v.url.search, socketTimeoutMs: limits.socketTimeoutMs,
            headers: { 'User-Agent': o.userAgent || POLICY.userAgent, Accept: POLICY.accept, 'Accept-Encoding': POLICY.acceptEncoding } });
          Promise.resolve(pending).then(r => { if (over && r && typeof r.abort === 'function') r.abort(); }, () => { /* erreur gérée par la course */ });   // réponse tardive après délai : fermée
          res = await guard(pending);
          used = a; break;
        } catch (e) {
          if (e instanceof FetchError) throw e;
          lastErr = e;
          if (e && /CERT|TLS|SSL|ERR_TLS|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH/i.test(String(e.code || e.message))) throw new FetchError('tls_error', String(e.code || ''));
        }
      }
      if (!res) throw new FetchError('connection_error', lastErr && lastErr.code ? String(lastErr.code) : null);
      const step = { url: v.href, hostname: v.hostname, address: used.address, family: used.family, status: null, location: null };
      result.trace.push(step);
      try {
        if (!res || !Number.isInteger(res.statusCode) || res.statusCode < 100 || res.statusCode > 599 || typeof res.headers !== 'object' || !res.headers || !res.body) throw new FetchError('http_invalid_response');
        step.status = res.statusCode;
        if (typeof res.remoteAddress !== 'string' || !res.remoteAddress) throw new FetchError('connection_address_unverified');
        if (ipKey(res.remoteAddress) === null || ipKey(res.remoteAddress) !== ipKey(used.address)) throw new FetchError('connection_address_mismatch', { validated: used.address, connected: res.remoteAddress });
        const status = res.statusCode;
        if (POLICY.redirectStatuses.includes(status)) {
          const loc = res.headers.location;
          if (typeof loc !== 'string' || !loc.trim()) throw new FetchError('redirect_without_location');
          if (result.redirects.length >= limits.maxRedirects) throw new FetchError('too_many_redirects');
          let next;
          try { next = new URL(loc.trim(), v.url).href; } catch (e) { throw new FetchError('redirect_invalid_location'); }
          const nv = validateUrl(next);
          step.location = next;
          result.redirects.push({ from: v.href, to: nv.ok ? nv.href : next, status });
          if (!nv.ok) { current = next; throw new FetchError(nv.code, { redirect: true }); }
          v = nv;
          continue;
        }
        if (status !== 200) throw new FetchError(status >= 400 ? 'http_error_status' : 'http_unexpected_status', { status });
        const ct = parseContentType(res.headers['content-type']);
        if (!ct) throw new FetchError('content_type_missing');
        if (!POLICY.allowedContentTypes.includes(ct.mime)) throw new FetchError('content_type_not_allowed', { contentType: ct.mime });
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > limits.maxRawBytes) throw new FetchError('body_too_large', { limit: 'declared' });
        const enc = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (enc !== 'identity' && !Object.prototype.hasOwnProperty.call(DECODERS, enc)) throw new FetchError('content_encoding_not_supported', { encoding: enc });
        const got = await guard(readBody(res, limits, enc === 'identity' ? null : enc));
        let text, charset = ct.charset || 'utf-8';
        try { text = new TextDecoder(charset, { fatal: false }).decode(got.buffer); } catch (e) { result.warnings.push('charset_unknown'); charset = 'utf-8'; text = new TextDecoder('utf-8', { fatal: false }).decode(got.buffer); }
        result.ok = true; result.status = status; result.finalUrl = v.href; result.contentType = ct.mime; result.charset = charset; result.rawBytes = got.rawBytes; result.bytes = got.bytes; result.body = text;
        return clean(finish(result, t0, deps));
      } catch (e) {
        if (res && typeof res.__stop === 'function') res.__stop(); else if (res && typeof res.abort === 'function') { try { res.abort(); } catch (x) { /* déjà fermé */ } }
        const unverified = e instanceof FetchError && (e.code === 'connection_address_mismatch' || e.code === 'connection_address_unverified');      // réponse venue d'une adresse non validée : ni statut ni URL finale
        if (step.status !== null && !unverified) { result.status = step.status; if (!(e instanceof FetchError) || !POLICY.redirectStatuses.includes(step.status)) result.finalUrl = v.href; }
        throw e;
      }
    }
  } catch (e) {
    fail(e);
    return clean(finish(result, t0, deps));
  } finally { over = true; clearTimeout(timer); }
}
function finish(result, t0, deps) { result.elapsedMs = Math.max(0, deps.now() - t0); return result; }

module.exports = { SCHEMA, LIMITS, POLICY, FAILURES, V4_SPECIAL, V6_SPECIAL, V6_GLOBAL, V6_ALLOCATED, V6_ALLOCATED_STATUS, FetchError, validateUrl, classifyIp, resolveValidated, buildRequestOptions, defaultRequest, fetchPage, parseContentType };
