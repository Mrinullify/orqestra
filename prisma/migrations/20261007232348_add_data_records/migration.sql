-- CreateTable
CREATE TABLE "DataRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "dataImportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataRecord_organizationId_dataSourceId_idx" ON "DataRecord"("organizationId", "dataSourceId");

-- CreateIndex
CREATE INDEX "DataRecord_organizationId_dataImportId_idx" ON "DataRecord"("organizationId", "dataImportId");

-- CreateIndex
CREATE UNIQUE INDEX "DataRecord_dataImportId_rowNumber_key" ON "DataRecord"("dataImportId", "rowNumber");

-- AddForeignKey
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRecord" ADD CONSTRAINT "DataRecord_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
