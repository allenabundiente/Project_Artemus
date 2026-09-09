-- Capes join the wardrobe: widen the shop_items category check so cape
-- cosmetics can be seeded alongside hair/armor/helmet.
ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_category_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_category_check
  CHECK (category IN ('hair', 'armor', 'helmet', 'cape', 'pack'));
