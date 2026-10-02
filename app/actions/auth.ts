"use server";

import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { checkRateLimit, RATE_LIMITS } from "@/app/lib/rate-limit";
import { headers } from "next/headers";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const LoginSchema = z.object({
    email: z.string().email("Please enter a valid email address.").toLowerCase().trim(),
    password: z.string().min(1, "Password is required."),
});

export type LoginState =
    | { errors?: { email?: string[]; password?: string[] }; message?: string }
    | undefined;

// ---------------------------------------------------------------------------
// Login Action (Auth.js Credentials)
// ---------------------------------------------------------------------------

export async function loginAction(state: LoginState, formData: FormData): Promise<LoginState> {
    const raw = {
        email: formData.get("email"),
        password: formData.get("password"),
    };

    const parsed = LoginSchema.safeParse(raw);
    if (!parsed.success) {
        return { errors: parsed.error.flatten().fieldErrors };
    }

    const { email, password } = parsed.data;

    // Rate Limiting Check (by IP + email)
    const reqHeaders = await headers();
    const ip = reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
    const rateLimitKey = `login:${ip}:${email}`;

    const rl = await checkRateLimit(
        rateLimitKey,
        RATE_LIMITS.LOGIN.maxRequests,
        RATE_LIMITS.LOGIN.windowSeconds
    );

    if (!rl.success) {
        return {
            message: `Too many login attempts. Please wait ${rl.reset - Math.floor(Date.now() / 1000)} seconds before trying again.`,
        };
    }

    try {
        await signIn("credentials", {
            email,
            password,
            redirectTo: "/dashboard",
        });
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case "CredentialsSignin":
                    return { message: "Invalid email or password." };
                default:
                    return { message: "An authentication error occurred. Please try again." };
            }
        }
        // Rethrow Next.js redirect errors (Next.js handles redirects by throwing)
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Logout Action (Auth.js)
// ---------------------------------------------------------------------------

export async function logoutAction(): Promise<void> {
    await signOut({ redirectTo: "/login" });
}
