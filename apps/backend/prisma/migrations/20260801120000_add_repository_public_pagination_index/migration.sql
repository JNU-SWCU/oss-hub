-- todo 16: composite index backing the public projects list route's
-- keyset (cursor) pagination — ORDER BY publishedAt DESC, id DESC filtered
-- by visibility = 'PUBLIC'.
CREATE INDEX "Repository_visibility_publishedAt_id_idx"
ON "Repository"("visibility", "publishedAt", "id");
