-- Ajoute le rôle DEX (Direction Exploitation) — décisions hiérarchiques
-- (validation N+1, validation DEX avant sortie §15) et signature/cachet
-- apposés sur les bons de sortie. Miroir de DEX_ROLES côté frontend
-- (dos-config-store.js). Séparé dans son propre fichier de migration car
-- ALTER TYPE ... ADD VALUE ne peut pas être utilisé dans la même
-- transaction qu'un usage de ce type (voir migration suivante).
ALTER TYPE "UserRole" ADD VALUE 'DEX';
