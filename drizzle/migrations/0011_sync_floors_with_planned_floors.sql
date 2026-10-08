CREATE OR REPLACE FUNCTION public.sync_building_floors() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.floors (building_id, floor_number, name)
  SELECT NEW.id, g, CASE WHEN g = 0 THEN 'Ground Floor' ELSE 'Floor ' || g END
  FROM generate_series(0, NEW.planned_floors) g
  ON CONFLICT (building_id, floor_number) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS buildings_sync_floors ON public.buildings;
CREATE TRIGGER buildings_sync_floors AFTER INSERT OR UPDATE OF planned_floors ON public.buildings
FOR EACH ROW EXECUTE FUNCTION public.sync_building_floors();
INSERT INTO public.floors (building_id, floor_number, name)
SELECT b.id, g, CASE WHEN g = 0 THEN 'Ground Floor' ELSE 'Floor ' || g END
FROM public.buildings b CROSS JOIN LATERAL generate_series(0, b.planned_floors) g
ON CONFLICT (building_id, floor_number) DO NOTHING;