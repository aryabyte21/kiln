import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const exampleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = exampleSchema.parse(body);

    // Simulate processing
    return NextResponse.json(
      {
        success: true,
        message: 'Data received successfully',
        data: validated,
        timestamp: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'This endpoint accepts POST requests with name, email, and message fields',
    example: {
      name: 'John Doe',
      email: 'john@example.com',
      message: 'Hello from CS5224!',
    },
  });
}
