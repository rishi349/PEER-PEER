-- Tree from master spec §46:
-- A (ROOT_LEADER)
-- └── B (LEADER)
--     ├── P1 (PEER)
--     └── C (LEADER)
--         └── P2 (PEER)

INSERT INTO organizations (id, name) VALUES ('org1', 'Test Org');

INSERT INTO users (id, "organizationId", "parentId", name, email, "passwordHash", role, status) VALUES
  ('A',  'org1', NULL, 'Root A',  'a@test.com',  'x', 'ROOT_LEADER', 'ACTIVE'),
  ('B',  'org1', 'A',  'Leader B','b@test.com',  'x', 'LEADER',      'ACTIVE'),
  ('P1', 'org1', 'B',  'Peer 1',  'p1@test.com', 'x', 'PEER',        'ACTIVE'),
  ('C',  'org1', 'B',  'Leader C','c@test.com',  'x', 'LEADER',      'ACTIVE'),
  ('P2', 'org1', 'C',  'Peer 2',  'p2@test.com', 'x', 'PEER',        'ACTIVE');
