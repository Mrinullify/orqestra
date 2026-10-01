/**
 * bootstrap-hr.ts
 *
 * One-time CLI script to create the first organization and HR user.
 * Run with:
 *   npx tsx scripts/bootstrap-hr.ts
 *
 * Required environment variables:
 *   DATABASE_URL       - PostgreSQL connection string
 *   DIRECT_URL         - Direct PostgreSQL connection (for Prisma migrate)
 *   BOOTSTRAP_SECRET   - Server secret that authorizes this operation
 *   BOOTSTRAP_ORG_NAME - Name of the organization to create
 *   BOOTSTRAP_HR_EMAIL - Email for the initial HR user
 *   BOOTSTRAP_HR_NAME  - Full name of the initial HR user
 *   BOOTSTRAP_HR_PASS  - Temporary password (will be overridable via invitation)
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client";

const required = [
    "DATABASE_URL",
    "BOOTSTRAP_SECRET",
    "BOOTSTRAP_ORG_NAME",
    "BOOTSTRAP_HR_EMAIL",
    "BOOTSTRAP_HR_NAME",
    "BOOTSTRAP_HR_PASS",
];

for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌  Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const bootstrapSecret = process.env.BOOTSTRAP_SECRET!;
const inputSecret = process.argv[2];

if (!inputSecret || inputSecret !== bootstrapSecret) {
    console.error("❌  Invalid bootstrap secret. Pass the secret as the first argument:");
    console.error("    npx tsx scripts/bootstrap-hr.ts <BOOTSTRAP_SECRET>");
    process.exit(1);
}

async function main() {
    const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
    const prisma = new PrismaClient({ adapter });

    const orgName = process.env.BOOTSTRAP_ORG_NAME!;
    const hrEmail = process.env.BOOTSTRAP_HR_EMAIL!.toLowerCase().trim();
    const hrName = process.env.BOOTSTRAP_HR_NAME!;
    const hrPass = process.env.BOOTSTRAP_HR_PASS!;

    // Check if an HR user already exists in any organization
    const existingHR = await prisma.membership.findFirst({
        where: { role: "HR" },
    });

    if (existingHR) {
        console.error(
            "❌  An HR user already exists. Bootstrap is a one-time operation.\n" +
            "    Use the HR employee management UI to add additional HR users."
        );
        await prisma.$disconnect();
        process.exit(1);
    }

    // Check if email is already taken
    const existingUser = await prisma.user.findUnique({ where: { email: hrEmail } });
    if (existingUser) {
        console.error(`❌  Email ${hrEmail} is already registered.`);
        await prisma.$disconnect();
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash(hrPass, 12);

    await prisma.$transaction(async (tx) => {
        // Create organization
        const org = await tx.organization.create({
            data: { name: orgName },
        });
        console.log(`✓  Created organization: "${orgName}" (${org.id})`);

        // Create HR user
        const user = await tx.user.create({
            data: {
                email: hrEmail,
                name: hrName,
                passwordHash,
                isActive: true,
                organizationId: org.id,
            },
        });
        console.log(`✓  Created HR user: ${hrName} <${hrEmail}> (${user.id})`);

        // Create HR membership
        await tx.membership.create({
            data: {
                userId: user.id,
                organizationId: org.id,
                role: "HR",
            },
        });
        console.log(`✓  Assigned HR role to ${hrEmail}`);
    });

    console.log("\n✅  Bootstrap complete. You can now sign in at /login.");
    console.log(
        "⚠️   Change the HR password after first login or set a strong BOOTSTRAP_HR_PASS."
    );

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error("Bootstrap failed:", err);
    process.exit(1);
});
