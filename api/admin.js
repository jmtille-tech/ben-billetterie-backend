// api/admin.js
// Endpoint interne (réservé à Jean-Marc) pour consulter et valider les entretiens BEN Billetterie.
// Protégé par un mot de passe partagé (ADMIN_PASSWORD, en variable d'environnement).
// Utilise la clé Supabase service_role (SUPABASE_SERVICE_ROLE_KEY), qui contourne la RLS —
// cette clé ne quitte jamais le serveur.

async function supabaseRequest(path, options) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Variables Supabase manquantes côté serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const response = await fetch(SUPABASE_URL + path, Object.assign({
    headers: Object.assign({
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    }, (options && options.headers) || {})
  }, options || {}));
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Erreur Supabase (' + response.status + ') : ' + errText);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const body = req.body || {};
    const password = body.password;
    const action = body.action;

    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur.' });
      return;
    }
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Mot de passe incorrect.' });
      return;
    }

    if (action === 'list') {
      const rows = await supabaseRequest(
        '/rest/v1/ben_entretiens?select=*&order=created_at.desc',
        { method: 'GET' }
      );
      res.status(200).json({ rows: rows });
      return;
    }

    if (action === 'validate') {
      const id = body.id;
      if (!id) {
        res.status(400).json({ error: 'id manquant.' });
        return;
      }
      await supabaseRequest(
        '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ statut: 'valide', valide_at: new Date().toISOString() })
        }
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'note') {
      const id = body.id;
      const notes = body.notes || '';
      if (!id) {
        res.status(400).json({ error: 'id manquant.' });
        return;
      }
      await supabaseRequest(
        '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ notes_jeanmarc: notes })
        }
      );
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
};
