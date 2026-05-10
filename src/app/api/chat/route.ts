import { NextRequest, NextResponse } from 'next/server';
import { WorkflowManager } from '@/agents/WorkflowManager';

const workflowManager = new WorkflowManager();

export async function POST(req: NextRequest) {
  try {
    const { email, query } = await req.json();

    if (!email || !query) {
      return NextResponse.json(
        { error: 'Email and query are required.' },
        { status: 400 }
      );
    }

    const result = await workflowManager.processQuery(email, query);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { error: 'An internal error occurred while processing your request.' },
      { status: 500 }
    );
  }
}
