'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskFormProps {
  swarmName: string;
  /** Agent role names available in this swarm (for the optional dropdown). */
  agentRoles: string[];
}

interface SubmitTaskBody {
  input: string;
  agentRole?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_URL || 'http://localhost:9090';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskForm({ swarmName, agentRoles }: TaskFormProps) {
  const [input, setInput] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      setSubmitting(true);
      setError(null);
      setSuccess(false);

      const body: SubmitTaskBody = { input: trimmed };
      if (selectedRole) {
        body.agentRole = selectedRole;
      }

      try {
        const res = await fetch(`${CONTROL_PLANE_URL}/api/v1/swarms/${swarmName}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API error (${res.status}): ${text}`);
        }

        setInput('');
        setSelectedRole('');
        setSuccess(true);

        // Clear success indicator after 3 seconds
        setTimeout(() => setSuccess(false), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit task');
      } finally {
        setSubmitting(false);
      }
    },
    [input, selectedRole, swarmName]
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Submit Task</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task input */}
          <div className="space-y-2">
            <Label htmlFor="task-input">Task Input</Label>
            <Input
              id="task-input"
              placeholder="Describe the task for the swarm..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Agent role selector */}
          {agentRoles.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="agent-role">Agent Role (optional)</Label>
              <select
                id="agent-role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                disabled={submitting}
                className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Any role</option>
                {agentRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error message */}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Success message */}
          {success && <p className="text-sm text-emerald-400">Task submitted successfully.</p>}

          {/* Submit button */}
          <Button type="submit" disabled={submitting || !input.trim()} className="w-full">
            {submitting ? 'Submitting...' : 'Submit Task'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
