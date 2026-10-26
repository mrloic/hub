-- Additive enum change; existing memberships and the unique OWNER index are unchanged.
ALTER TYPE "Role" ADD VALUE 'CO_OWNER' AFTER 'OWNER';
