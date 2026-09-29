-- ============================================================
-- 0016: shop_items.category — admit the 'character' category
-- ============================================================
-- The pack-characters work sells full-character skins (Hooded Wanderer,
-- Brimward Warden, …) in the SHOP_CATEGORIES allowlist, but no migration ever
-- widened the shop_items_category_check constraint — only 0006's cape did.
-- Result: the boot seed fails on every fresh database ("violates check
-- constraint shop_items_category_check") and the four buyable characters
-- never appear in the shop. Widen the check to match the code allowlist.

ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_category_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_category_check
  CHECK (category IN ('hair', 'armor', 'helmet', 'cape', 'pack', 'character'));
