-- Keep logical datasets separate from individual uploaded files.
ALTER TABLE "DataSource"
ADD COLUMN "schema" JSONB;

CREATE INDEX "DataSource_organizationId_name_idx"
ON "DataSource"("organizationId", "name");

-- File-specific metadata belongs to an import, not only to the logical dataset.
ALTER TABLE "DataImport"
ADD COLUMN "originalName" TEXT,
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "fileType" "DataSourceType",
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "sizeBytes" BIGINT,
ADD COLUMN "reportingPeriod" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
