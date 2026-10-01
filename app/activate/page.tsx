import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ActivateForm from "./ActivateForm";
import crypto from "crypto";
import { prisma } from "@/app/lib/prisma";

export const metadata: Metadata = {
    title: "Activate account — Orqestra",
};

interface Props {
    searchParams: Promise<{ token?: string }>;
}

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export default async function ActivatePage({ searchParams }: Props) {
    const params = await searchParams;
    const token = params.token;

    if (!token) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
                <div className="w-full max-w-md text-center">
                    <h1 className="text-xl font-semibold text-zinc-900 mb-2">Invalid invitation link</h1>
                    <p className="text-sm text-zinc-500">
                        This link is missing a token. Please use the link from your invitation email.
                    </p>
                </div>
            </div>
        );
    }

    // Look up the invitation to show org name
    const tokenHash = hashToken(token);
    const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
        include: { organization: { select: { name: true } } },
    });

    let organizationName = "your organization";
    let invitationInvalid = false;
    let invalidReason = "";

    if (!invitation) {
        invitationInvalid = true;
        invalidReason = "This invitation link is invalid or has already been used.";
    } else if (invitation.status === "ACCEPTED") {
        invitationInvalid = true;
        invalidReason = "This invitation has already been accepted. You can sign in below.";
    } else if (invitation.status === "REVOKED") {
        invitationInvalid = true;
        invalidReason = "This invitation has been revoked. Please contact your HR team.";
    } else if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
        invitationInvalid = true;
        invalidReason = "This invitation has expired. Please ask your HR team for a new one.";
    } else {
        organizationName = invitation.organization.name;
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Orqestra</h1>
                    <p className="mt-2 text-sm text-zinc-500">AI-powered Operations Copilot</p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white px-8 py-8 shadow-sm">
                    {invitationInvalid ? (
                        <div className="text-center space-y-4">
                            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                                <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </div>
                            <h2 className="text-lg font-semibold text-zinc-900">Invitation unavailable</h2>
                            <p className="text-sm text-zinc-500">{invalidReason}</p>
                            <a href="/login" className="inline-block text-sm font-medium text-zinc-900 underline">
                                Go to sign in
                            </a>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <h2 className="text-lg font-semibold text-zinc-900">Activate your account</h2>
                                <p className="mt-1 text-sm text-zinc-500">
                                    You&apos;ve been invited to join <strong className="text-zinc-700">{organizationName}</strong>.
                                    Set a password to get started.
                                </p>
                            </div>
                            <ActivateForm token={token} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
