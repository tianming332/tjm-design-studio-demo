-- Skill library categories (Agent 系统设计 §19.2): style / capability / purpose / workflow.
ALTER TABLE workbench_skills ADD COLUMN category TEXT NOT NULL DEFAULT 'workflow';
ALTER TABLE workbench_skill_versions ADD COLUMN category TEXT NOT NULL DEFAULT 'workflow';
UPDATE workbench_skills SET category='capability' WHERE slug IN ('text-effects','region-edit','layer-decompose');
UPDATE workbench_skill_versions SET category='capability' WHERE skill_id IN (SELECT id FROM workbench_skills WHERE slug IN ('text-effects','region-edit','layer-decompose'));
