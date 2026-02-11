import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'CS5224 API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      web: 'http://localhost:3000',
      fastapi: 'http://localhost:8000',
      go: 'http://localhost:8080',
    },
  });
}
