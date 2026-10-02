import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/app/lib/prisma";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            organizationId: string;
            role: "HR" | "EMPLOYEE";
        } & DefaultSession["user"];
    }

    interface User {
        id?: string;
        organizationId?: string;
        role?: "HR" | "EMPLOYEE";
    }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const email = String(credentials.email).toLowerCase().trim();
                const password = String(credentials.password);

                const user = await prisma.user.findUnique({
                    where: { email },
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        passwordHash: true,
                        isActive: true,
                        organizationId: true,
                        role: true,
                    },
                });

                if (!user || !user.passwordHash) {
                    return null;
                }

                // Inactive users cannot log in!
                if (!user.isActive) {
                    return null;
                }

                const passwordMatch = await bcrypt.compare(password, user.passwordHash);
                if (!passwordMatch) {
                    return null;
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    organizationId: user.organizationId,
                    role: user.role,
                };
            },
        }),
    ],
    session: {
        strategy: "jwt",
        maxAge: 7 * 24 * 60 * 60, // 7 days
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                (token as any).organizationId = user.organizationId;
                (token as any).role = user.role;
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string;
                session.user.organizationId = (token as any).organizationId as string;
                session.user.role = (token as any).role as "HR" | "EMPLOYEE";
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET,
});
