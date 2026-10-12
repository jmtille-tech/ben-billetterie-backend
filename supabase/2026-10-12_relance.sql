-- Relance automatique des synthèses non validées (api/relances.js).
-- À exécuter une seule fois dans Supabase : SQL Editor → New query → coller → Run.
-- Sans risque : ajoute une colonne vide, ne modifie aucune donnée existante.
alter table ben_entretiens add column if not exists relance_envoyee_at timestamptz;
