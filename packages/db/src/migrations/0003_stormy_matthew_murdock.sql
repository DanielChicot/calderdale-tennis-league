-- Known alias from Phase 1 discovery (memory note: upstream-uses-two-names-for-the-same-club)
INSERT INTO clubs (slug, canonical_name, needs_review)
VALUES ('halifax-queens', 'Queens Sports Club', false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO club_aliases (club_id, observed_name)
SELECT id, 'Queens Sports Club' FROM clubs WHERE slug = 'halifax-queens'
ON CONFLICT (observed_name) DO NOTHING;

INSERT INTO club_aliases (club_id, observed_name)
SELECT id, 'Halifax Queens' FROM clubs WHERE slug = 'halifax-queens'
ON CONFLICT (observed_name) DO NOTHING;