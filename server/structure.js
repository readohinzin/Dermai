'use strict';
/* Décrit la STRUCTURE d'un JSON (chemins + types) sans jamais en révéler une valeur.
   Utilisé pour les logs serveur : pas de valeurs, pas d'URL, pas d'identifiants, pas de photo. */

/* Un nom de champ normal ne contient que [A-Za-z0-9_.-]. Tout autre nom (URL, identifiant, texte libre) est masqué. */
const safeKey = k => (/^[A-Za-z0-9_.-]{1,40}$/.test(String(k)) ? String(k) : '<autre>');

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;     // string | number | boolean | object | undefined
}

/* Renvoie une liste triée de lignes « chemin: type ». Les tableaux sont décrits par leurs éléments (chemin[]). */
function describeStructure(value, { maxDepth = 8, maxPaths = 500 } = {}) {
  const seen = new Set();
  const add = line => { if (seen.size < maxPaths) seen.add(line); };
  (function walk(v, path, depth) {
    const t = typeOf(v);
    if (t === 'array') {
      add(`${path || '$'}: array`);
      if (depth < maxDepth) v.slice(0, 20).forEach(item => walk(item, `${path || '$'}[]`, depth + 1));
    } else if (t === 'object') {
      add(`${path || '$'}: object`);
      if (depth < maxDepth) Object.keys(v).slice(0, 100).forEach(k => walk(v[k], path ? `${path}.${safeKey(k)}` : safeKey(k), depth + 1));
    } else {
      add(`${path || '$'}: ${t}`);
    }
  })(value, '', 0);
  return [...seen].sort();
}

module.exports = { describeStructure };
