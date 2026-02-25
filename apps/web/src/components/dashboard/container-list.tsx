'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { listContainers, type Container } from '@/lib/api-client';
import { MessageSquare, Monitor } from 'lucide-react';

interface ContainerListProps {
  swarmName: string;
}

function formatUptime(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - created;

  if (diffMs < 0) return '0s';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function ContainerList({ swarmName }: ContainerListProps) {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    try {
      const data = await listContainers(swarmName);
      setContainers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch containers');
    } finally {
      setLoading(false);
    }
  }, [swarmName]);

  useEffect(() => {
    fetchContainers();

    const interval = setInterval(fetchContainers, 5000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  const healthyCount = containers.filter((c) => c.healthy).length;
  const totalCount = containers.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Containers</CardTitle>
        <CardDescription>
          {loading
            ? 'Loading containers...'
            : error
              ? 'Failed to load containers'
              : `${healthyCount}/${totalCount} healthy`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && !loading && <p className="text-sm text-zinc-500 text-center py-6">{error}</p>}
        {!error && containers.length === 0 && !loading && (
          <p className="text-sm text-zinc-500 text-center py-6">No containers running.</p>
        )}
        {containers.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead className="text-right">WebUI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers.map((container) => (
                <TableRow key={container.id}>
                  <TableCell className="font-mono text-xs">{container.id.slice(0, 12)}</TableCell>
                  <TableCell>{container.role}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {container.addr}:{container.port}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          container.healthy ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                      <Badge
                        variant={container.healthy ? 'default' : 'destructive'}
                        className={container.healthy ? 'bg-emerald-600 text-xs' : 'text-xs'}
                      >
                        {container.healthy ? 'Healthy' : 'Unhealthy'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400">
                    {formatUptime(container.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                        asChild
                      >
                        <a href={`/dashboard/agent/${container.id}`} title="Chat with this agent">
                          <MessageSquare className="h-3.5 w-3.5 mr-1" />
                          Chat
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                        asChild
                      >
                        <a
                          href={`${process.env.NEXT_PUBLIC_CONTROLPLANE_URL || 'http://localhost:9090'}/api/v1/containers/${container.id}/ui`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open OpenClaw Dashboard (proxied with auth)"
                        >
                          <Monitor className="h-3.5 w-3.5 mr-1" />
                          WebUI
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
