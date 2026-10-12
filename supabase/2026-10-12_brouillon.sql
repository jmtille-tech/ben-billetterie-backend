-- Enregistrement des entretiens en cours (brouillons), pour reprendre un entretien
-- interrompu depuis n'importe quel appareil et le relancer par email.
-- À exécuter une seule fois dans Supabase : SQL Editor → New query → coller → Run.
-- Sans risque : ajoute deux colonnes vides, ne modifie aucune donnée existante.
alter table ben_entretiens add column if not exists conversation jsonb;
alter table ben_entretiens add column if not exists derniere_activite_at timestamptz;
