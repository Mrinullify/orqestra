
import { NextResponse } from "next/server";
import Papa from "papaparse";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_SAMPLE_ROWS = 10;

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "Please upload a CSV file." },
                { status: 400 }
            );
        }

        if (!file.name.toLowerCase().endsWith(".csv")) {
            return NextResponse.json(
                { error: "Only CSV files are supported right now." },
                { status: 400 }
            );
        }

        if (file.size === 0 || file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: "The file must be non-empty and no larger than 5 MB." },
                { status: 400 }
            );
        }

        const text = await file.text();

        const result = Papa.parse<string[]>(text, {
            skipEmptyLines: true,
            preview: MAX_SAMPLE_ROWS + 1,
        });

        if (result.errors.length > 0) {
            return NextResponse.json(
                {
                    error: "The CSV could not be parsed.",
                    details: result.errors.slice(0, 5).map((e) => e.message),
                },
                { status: 400 }
            );
        }

        const rows = result.data;

        if (rows.length < 2 || !rows[0]?.length) {
            return NextResponse.json(
                { error: "The CSV must contain a header and at least one data row." },
                { status: 400 }
            );
        }

        const headers = rows[0].map((header) => header.trim());

        if (headers.some((header) => !header)) {
            return NextResponse.json(
                { error: "Column headers cannot be empty." },
                { status: 400 }
            );
        }

        return NextResponse.json({
            filename: file.name,
            sizeBytes: file.size,
            columns: headers,
            sampleRows: rows.slice(1, MAX_SAMPLE_ROWS + 1),
            sampleRowCount: rows.length - 1,
            truncated: true,
        });
    } catch (error) {
        console.error("CSV inspection failed:", error);

        return NextResponse.json(
            { error: "Unable to inspect the uploaded file." },
            { status: 500 }
        );
    }
}