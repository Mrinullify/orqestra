import "server-only";
import { prisma } from "./prisma";
import { sendInvitationEmail } from "./email";
import crypto from "crypto";

export interface InvitationJobData {
    invitationId: string;
    token: string;
}

const INVITATION_EXPIRY_HOURS = Number(process.env.INVITATION_EXPIRY_HOURS ?? "24");

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Process a single invitation email job asynchronously.
 * Updates Invitation status: QUEUED -> PROCESSING -> SENT / FAILED.
 * Is idempotent: retrying a job updates the existing invitation record rather than creating a duplicate.
 */
export async function processInvitationJob(jobData: InvitationJobData): Promise<{ success: boolean; error?: string }> {
    const { invitationId, token } = jobData;

    const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
        include: {
            organization: { select: { name: true } },
            invitedBy: { select: { name: true } },
        },
    });

    if (!invitation) {
        return { success: false, error: "Invitation not found" };
    }

    if (invitation.status === "ACCEPTED" || invitation.status === "REVOKED") {
        return { success: false, error: `Cannot process invitation in state ${invitation.status}` };
    }

    // Mark as PROCESSING
    await prisma.invitation.update({
        where: { id: invitationId },
        data: { status: "PROCESSING" },
    });

    // Find recipient user name if available
    const recipientUser = await prisma.user.findUnique({
        where: { email: invitation.email },
        select: { name: true },
    });

    // Send email via email service
    const emailResult = await sendInvitationEmail({
        toEmail: invitation.email,
        toName: recipientUser?.name ?? null,
        organizationName: invitation.organization.name,
        invitationToken: token,
    });

    if (emailResult.success) {
        await prisma.invitation.update({
            where: { id: invitationId },
            data: {
                status: "SENT",
                sentAt: new Date(),
                failureReason: null,
            },
        });
        return { success: true };
    } else {
        await prisma.invitation.update({
            where: { id: invitationId },
            data: {
                status: "FAILED",
                failureReason: emailResult.error,
            },
        });
        return { success: false, error: emailResult.error };
    }
}

/**
 * Asynchronous job queue for background processing of invitation jobs.
 * Enqueues jobs so that server actions and API routes return instantly (non-blocking).
 * Processes jobs with controlled concurrency and error resilience.
 */
class InvitationJobQueue {
    private queue: InvitationJobData[] = [];
    private activeWorkers = 0;
    private readonly maxConcurrency = 5; // Process up to 5 emails concurrently

    public enqueue(job: InvitationJobData): void {
        this.queue.push(job);
        this.triggerProcessing();
    }

    public enqueueBatch(jobs: InvitationJobData[]): void {
        this.queue.push(...jobs);
        this.triggerProcessing();
    }

    private triggerProcessing(): void {
        while (this.activeWorkers < this.maxConcurrency && this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job) break;

            this.activeWorkers++;
            setImmediate(() => {
                processInvitationJob(job)
                    .catch((err) => {
                        console.error("Unhandled error in background job worker:", err);
                    })
                    .finally(() => {
                        this.activeWorkers--;
                        this.triggerProcessing();
                    });
            });
        }
    }

    public getPendingCount(): number {
        return this.queue.length;
    }

    public getActiveWorkersCount(): number {
        return this.activeWorkers;
    }
}

// Global singleton for background queue
const globalForQueue = globalThis as unknown as {
    invitationQueue?: InvitationJobQueue;
};

export const invitationQueue =
    globalForQueue.invitationQueue ?? new InvitationJobQueue();

if (process.env.NODE_ENV !== "production") {
    globalForQueue.invitationQueue = invitationQueue;
}
