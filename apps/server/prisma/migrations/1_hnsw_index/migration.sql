-- HNSW index for cosine-distance vector search on job embeddings.
-- Tuned for recall/speed balance at small-to-medium scale.
CREATE INDEX IF NOT EXISTS "JobEmbedding_vector_hnsw_idx"
  ON "JobEmbedding" USING hnsw ("vector" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
