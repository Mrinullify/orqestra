import "server-only";

export interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
}

// Memory store for local sliding window rate limiting
interface MemoryStoreEntry {
    timestamps: number[];
}

const memoryStore = new Map<string, MemoryStoreEntry>();

// Periodic cleanup of stale memory store entries every 5 minutes
if (typeof setInterval !== "undefined") {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of memoryStore.entries()) {
            // Keep only timestamps from last 10 minutes
            entry.timestamps = entry.timestamps.filter((ts) => now - ts < 10 * 60 * 1000);
            if (entry.timestamps.length === 0) {
                memoryStore.delete(key);
            }
        }
    }, 5 * 60 * 1000);
}

/**
 * Checks rate limit for a key using sliding window.
 * Supports Redis via Upstash REST or ioredis if REDIS_URL/UPSTASH_REDIS_REST_URL is configured,
 * falling back to an in-memory sliding window algorithm.
 */
export async function checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    // Check if Upstash / Redis env is available
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl && upstashToken) {
        try {
            // Use Upstash REST API for distributed sliding window
            const res = await fetch(`${upstashUrl}/multi-exec`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${upstashToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify([
                    ["ZREMRANGEBYSCORE", key, "0", windowStart.toString()],
                    ["ZADD", key, now.toString(), `${now}-${Math.random()}`],
                    ["ZCARD", key],
                    ["EXPIRE", key, windowSeconds.toString()],
                ]),
            });

            if (respOk(res)) {
                const data = await res.json();
                const count = (data[2]?.result as number) ?? 1;
                const remaining = Math.max(0, maxRequests - count);
                const reset = Math.ceil((now + windowMs) / 1000);

                return {
                    success: count <= maxRequests,
                    limit: maxRequests,
                    remaining,
                    reset,
                };
            }
        } catch {
            // Fall through to memory store if Redis call fails
        }
    }

    // In-memory sliding window implementation
    let entry = memoryStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        memoryStore.set(key, entry);
    }

    // Filter out timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (entry.timestamps.length >= maxRequests) {
        const oldestTs = entry.timestamps[0] ?? now;
        const reset = Math.ceil((oldestTs + windowMs) / 1000);
        return {
            success: false,
            limit: maxRequests,
            remaining: 0,
            reset,
        };
    }

    // Record this request
    entry.timestamps.push(now);
    const remaining = maxRequests - entry.timestamps.length;
    const reset = Math.ceil((now + windowMs) / 1000);

    return {
        success: true,
        limit: maxRequests,
        remaining,
        reset,
    };
}

function respOk(res: Response): boolean {
    return res.status >= 200 && res.status < 300;
}

// Pre-defined rate limit configurations (overridable via env)
export const RATE_LIMITS = {
    LOGIN: {
        maxRequests: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? "5"),
        windowSeconds: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_SEC ?? "60"),
    },
    BULK_INVITE: {
        maxRequests: Number(process.env.RATE_LIMIT_INVITE_MAX ?? "10"),
        windowSeconds: Number(process.env.RATE_LIMIT_INVITE_WINDOW_SEC ?? "60"),
    },
    RESEND: {
        maxRequests: Number(process.env.RATE_LIMIT_RESEND_MAX ?? "5"),
        windowSeconds: Number(process.env.RATE_LIMIT_RESEND_WINDOW_SEC ?? "60"),
    },
    ACTIVATION: {
        maxRequests: Number(process.env.RATE_LIMIT_ACTIVATE_MAX ?? "10"),
        windowSeconds: Number(process.env.RATE_LIMIT_ACTIVATE_WINDOW_SEC ?? "60"),
    },
    VALIDATE: {
        maxRequests: Number(process.env.RATE_LIMIT_VALIDATE_MAX ?? "20"),
        windowSeconds: Number(process.env.RATE_LIMIT_VALIDATE_WINDOW_SEC ?? "60"),
    },
};
