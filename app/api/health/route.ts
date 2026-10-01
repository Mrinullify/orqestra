import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
    try {
        await prisma.$queryRaw`SELECT 1`;

        return NextResponse.json({
            status: "ok",
            database: "connected",
        });
    } catch (error) {
        console.error("Database health check failed:", error);

        return NextResponse.json(
            {
                status: "error",
                message: "Database connection failed",
            },
            { status: 500 }
        );
    }
}