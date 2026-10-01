import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface SessionPayload {
    userId: string;
    organizationId: string;
    role: "HR" | "EMPLOYEE";
    expiresAt: string;
}

const SESSION_COOKIE = "orqestra_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecretKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET environment variable is not set");
    return new TextEncoder().encode(secret);
}

export async function encrypt(payload: SessionPayload): Promise<string> {
    return new SignJWT({ ...payload })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(getSecretKey());
}

export async function decrypt(token: string): Promise<SessionPayload | null> {
    try {
        const { payload } = await jwtVerify(token, getSecretKey(), {
            algorithms: ["HS256"],
        });
        return payload as unknown as SessionPayload;
    } catch {
        return null;
    }
}

export async function createSession(data: Omit<SessionPayload, "expiresAt">): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const payload: SessionPayload = { ...data, expiresAt: expiresAt.toISOString() };
    const token = await encrypt(payload);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        expires: expiresAt,
        sameSite: "lax",
        path: "/",
    });
}

export async function getSession(): Promise<SessionPayload | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = await decrypt(token);
    if (!payload) return null;
    const expiresAt = new Date(payload.expiresAt);
    if (expiresAt < new Date()) return null;
    return payload;
}

export async function deleteSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
}

export async function requireSession(): Promise<SessionPayload> {
    const session = await getSession();
    if (!session) redirect("/login");
    return session;
}

export async function requireHR(): Promise<SessionPayload> {
    const session = await requireSession();
    if (session.role !== "HR") redirect("/dashboard");
    return session;
}
