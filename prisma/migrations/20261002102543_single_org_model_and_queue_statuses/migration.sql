/*
  Warnings:

  - You are about to drop the `Membership` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvitationStatus" ADD VALUE 'QUEUED';
ALTER TYPE "InvitationStatus" ADD VALUE 'PROCESSING';

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "OrganizationRole" NOT NULL DEFAULT 'EMPLOYEE';

-- DropTable
DROP TABLE "Membership";

-- CreateIndex
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");
