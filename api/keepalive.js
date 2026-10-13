module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
      res.status(401).json({ error: 'Non autorisé.' });
      return;
    }
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ error: 'Variables Supabase manquantes.' });
      return;
    }
    const response = await fetch(SUPABASE_URL + '/rest/v1/ben_entretiens?select=id&limit=1', {
      method: 'GET',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: 'Supabase (' + response.status + ') : ' + errText });
      return;
    }
    res.status(200).json({ ok: true, pinged_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
};
