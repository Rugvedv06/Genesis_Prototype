ALTER TABLE tools DROP CONSTRAINT tools_side_effects_check;
ALTER TABLE tools ADD CONSTRAINT tools_side_effects_check
  CHECK (side_effects IN ('read','write','none'));
