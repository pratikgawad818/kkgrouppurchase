-- Rejected quantity was added after the original constraint; the formula
-- must now be accepted = received - damaged - rejected.
ALTER TABLE public.goods_receipt_items DROP CONSTRAINT IF EXISTS goods_receipt_items_check;

ALTER TABLE public.goods_receipt_items ADD CONSTRAINT goods_receipt_items_check CHECK (
  accepted_quantity = received_quantity - damaged_quantity - rejected_quantity
  AND accepted_quantity >= 0
  AND damaged_quantity >= 0
  AND rejected_quantity >= 0
);