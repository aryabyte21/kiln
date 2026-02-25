'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  getContainer,
  chatWithContainer,
  type Container,
  type ChatMessage,
} from '@/lib/api-client';
import { ArrowLeft, Send, Loader2, Bot, User, Trash2, ExternalLink } from 'lucide-react';

interface DisplayMessage extends ChatMessage {
  id: string;
  tokensUsed?: number;
  model?: string;
  latencyMs?: number;
}

export default function AgentChatPage() {
  const params = useParams();
  const router = useRouter();
  const containerId = params.id as string;

  const [container, setContainer] = useState<Container | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const fetchContainer = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getContainer(containerId);
      setContainer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load container');
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    fetchContainer();
  }, [fetchContainer]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const chatHistory: ChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: trimmed },
      ];

      const start = performance.now();
      const response = await chatWithContainer(containerId, chatHistory);
      const latencyMs = Math.round(performance.now() - start);

      const assistantContent = response.choices?.[0]?.message?.content || '(No response)';

      const assistantMsg: DisplayMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantContent,
        tokensUsed: response.usage?.total_tokens,
        model: response.model,
        latencyMs,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: DisplayMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="border-b border-zinc-800 px-6 py-3">
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  if (error || !container) {
    return (
      <div className="p-6 space-y-4">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Container not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="text-zinc-400 hover:text-zinc-100 h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-100 text-sm">{container.role}</span>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-zinc-500 border-zinc-700"
                >
                  {container.swarmName}
                </Badge>
                <Badge
                  className={`text-[10px] px-1.5 py-0 ${
                    container.healthy
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                      : 'bg-red-500/15 text-red-400 border-red-500/20'
                  }`}
                >
                  {container.healthy ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <span className="text-[11px] font-mono text-zinc-600">
                {containerId.slice(0, 12)} &middot; :{container.port}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMessages([])}
              className="text-zinc-500 hover:text-zinc-300 h-8 w-8"
              title="Clear chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="text-zinc-500 hover:text-zinc-300 h-8 w-8"
            title="Open OpenClaw WebUI directly"
          >
            <a
              href={`http://localhost:${container.port}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/50 mb-4">
              <Bot className="h-8 w-8 text-zinc-500" />
            </div>
            <h3 className="text-lg font-medium text-zinc-300 mb-1">Chat with {container.role}</h3>
            <p className="text-sm text-zinc-600 max-w-sm">
              Send a message to interact directly with this agent. Messages are sent via the control
              plane to the OpenClaw container.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-emerald-400" />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-md'
                  : msg.content.startsWith('Error:')
                    ? 'bg-red-950/50 text-red-300 border border-red-800/40 rounded-bl-md'
                    : 'bg-zinc-800/80 text-zinc-200 border border-zinc-700/40 rounded-bl-md'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.role === 'assistant' && msg.tokensUsed !== undefined && (
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-700/30 text-[10px] text-zinc-500">
                  {msg.model && <span>{msg.model}</span>}
                  <span>{msg.tokensUsed} tokens</span>
                  {msg.latencyMs !== undefined && <span>{msg.latencyMs}ms</span>}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-700/50 mt-0.5">
                <User className="h-3.5 w-3.5 text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 mt-0.5">
              <Bot className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="bg-zinc-800/80 border border-zinc-700/40 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div
                  className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-zinc-800 bg-zinc-900/50 px-6 py-4">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${container.role}...`}
              rows={1}
              disabled={sending}
              className="w-full resize-none rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50 transition-colors"
              style={{ minHeight: '44px', maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            size="icon"
            className="h-11 w-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 shrink-0 transition-colors"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-zinc-700 text-center mt-2">
          Shift+Enter for new line &middot; Enter to send
        </p>
      </div>
    </div>
  );
}
