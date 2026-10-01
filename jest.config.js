/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: ["**/__tests__/**/*.test.ts"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1",
        "^server-only$": "<rootDir>/__tests__/__mocks__/server-only.ts",
    },
    transform: {
        "^.+\\.tsx?$": ["ts-jest", {
            tsconfig: {
                module: "commonjs",
                esModuleInterop: true,
            },
        }],
    },
};
