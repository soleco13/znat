-- Экспериментальная запись: возраст задания в очереди сборки (queued_at), очередь по возрасту.
ALTER TABLE "raw_recordings" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "raw_recordings_queue_idx" ON "raw_recordings" USING btree ("status","queued_at");--> statement-breakpoint
-- Момент первой постановки в очередь сборки — одним местом для всех путей
-- (финиш рекордера, пропавший рекордер, стоп без рекордера, повтор рендера).
CREATE OR REPLACE FUNCTION raw_recordings_set_queued_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'queued_for_render' AND NEW.queued_at IS NULL THEN
    NEW.queued_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER raw_recordings_queued_at BEFORE INSERT OR UPDATE OF status ON raw_recordings
  FOR EACH ROW EXECUTE FUNCTION raw_recordings_set_queued_at();--> statement-breakpoint
UPDATE raw_recordings SET queued_at = coalesce(stopped_at, started_at) WHERE queued_at IS NULL AND status <> 'requested' AND status <> 'recording';
