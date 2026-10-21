CREATE TYPE "DatasetPeriodMode" AS ENUM ('ADDITIVE', 'SNAPSHOT');

ALTER TABLE "DataSource"
ADD COLUMN "periodMode" "DatasetPeriodMode" NOT NULL DEFAULT 'ADDITIVE';
