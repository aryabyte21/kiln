'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  getSettings,
  saveSettings,
  listProviders,
  type PlatformSettings,
  type KnownProvider,
} from '@/lib/api-client';
import {
  Settings,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  Loader2,
  AlertTriangle,
  WifiOff,
} from 'lucide-react';

// Hardcoded fallback so the page works even when the backend is down
const FALLBACK_PROVIDERS: KnownProvider[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiType: 'openai-completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    signupUrl: 'https://console.groq.com',
    freeKeyNote: 'Free tier: 30 req/min, 14,400 req/day. No credit card needed.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiType: 'openai-completions',
    models: [
      'anthropic/claude-sonnet-4',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    signupUrl: 'https://openrouter.ai/keys',
    freeKeyNote: 'Many free models available. Pay-per-token for premium models.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiType: 'google-generative-ai',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    signupUrl: 'https://aistudio.google.com/apikey',
    freeKeyNote: 'Free tier: 15 req/min, 1,500 req/day for Flash models.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'openai-completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    signupUrl: 'https://platform.openai.com/api-keys',
    freeKeyNote: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiType: 'anthropic-messages',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514'],
    signupUrl: 'https://console.anthropic.com/',
    freeKeyNote: '',
  },
  {
    id: 'custom',
    name: 'Custom / Self-hosted',
    baseUrl: '',
    apiType: 'openai-completions',
    models: [],
    signupUrl: '',
    freeKeyNote: '',
  },
];

export default function SettingsPage() {
  const [providers, setProviders] = useState<KnownProvider[]>(FALLBACK_PROVIDERS);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiType, setApiType] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);

      // Try to fetch from backend — if it fails, use fallback providers
      const [settingsData, providerData] = await Promise.all([
        getSettings().catch(() => null),
        listProviders().catch(() => null),
      ]);

      if (providerData) {
        setProviders(providerData);
        setBackendOnline(true);
      }

      if (settingsData?.llm?.provider) {
        setSelectedProvider(settingsData.llm.provider);
        setApiKey(settingsData.llm.apiKey || '');
        setBaseUrl(settingsData.llm.baseUrl || '');
        setModel(settingsData.llm.model || '');
        setApiType(settingsData.llm.apiType || '');
        setBackendOnline(true);
      }
    } catch {
      // Silently use fallback providers
    } finally {
      setLoading(false);
    }
  }

  function handleProviderChange(providerId: string) {
    setSelectedProvider(providerId);
    setSaved(false);
    setSaveError(null);

    const provider = providers.find((p) => p.id === providerId);
    if (provider) {
      setBaseUrl(provider.baseUrl);
      setApiType(provider.apiType);
      if (provider.models.length > 0) {
        setModel(provider.models[0]);
      } else {
        setModel('');
      }
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      setSaveError(null);
      setSaved(false);

      const settings: PlatformSettings = {
        llm: {
          provider: selectedProvider,
          apiKey: apiKey,
          baseUrl: baseUrl,
          model: model,
          apiType: apiType,
        },
      };

      await saveSettings(settings);
      setSaved(true);
      setBackendOnline(true);

      // Refresh to get masked key back
      const refreshed = await getSettings().catch(() => null);
      if (refreshed?.llm?.apiKey) {
        setApiKey(refreshed.llm.apiKey);
      }

      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save. Is the control plane running?'
      );
    } finally {
      setSaving(false);
    }
  }

  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const isCustom = selectedProvider === 'custom';

  if (loading) {
    return (
      <div className="container py-10 max-w-2xl mx-auto space-y-6">
        <div className="h-8 w-48 rounded bg-zinc-800 animate-pulse" />
        <div className="h-[400px] w-full rounded-xl bg-zinc-800/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="container py-10 max-w-2xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
            <Settings className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          Platform Settings
        </h1>
        <p className="text-sm text-zinc-500">
          Configure the LLM provider for all agents across every swarm.
        </p>
      </div>

      {/* Backend status */}
      {!backendOnline && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3">
          <WifiOff className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="text-sm">
            <p className="text-amber-300 font-medium">Control plane not reachable</p>
            <p className="text-amber-400/70 text-xs mt-0.5">
              Start it with{' '}
              <code className="bg-amber-900/30 px-1.5 py-0.5 rounded text-amber-300">
                go run ./cmd/openswarm-controller
              </code>{' '}
              — you can still browse settings below.
            </p>
          </div>
        </div>
      )}

      {/* Provider Selection Card */}
      <Card className="border-zinc-800/80 bg-zinc-900/60 shadow-lg shadow-black/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-zinc-100">LLM Provider</CardTitle>
          <CardDescription className="text-zinc-500">
            Choose which AI provider your OpenClaw agents will use for inference.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Provider Dropdown */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-400">Provider</Label>
            <Select value={selectedProvider} onValueChange={handleProviderChange}>
              <SelectTrigger className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 hover:border-zinc-600 transition-colors">
                <SelectValue placeholder="Select a provider..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-zinc-100 focus:bg-zinc-700">
                    <div className="flex items-center gap-2">
                      {p.name}
                      {p.freeKeyNote && (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0 font-normal">
                          Free tier
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Provider Info Banner */}
          {currentProvider && currentProvider.freeKeyNote && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm text-emerald-300/90">{currentProvider.freeKeyNote}</p>
              {currentProvider.signupUrl && (
                <a
                  href={currentProvider.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 mt-1.5 transition-colors"
                >
                  Get your API key
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* API Key */}
          {selectedProvider && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-400">API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setSaved(false);
                    setSaveError(null);
                  }}
                  placeholder="sk-..."
                  className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 pr-10 font-mono text-sm hover:border-zinc-600 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-zinc-600">
                Stored securely on the server. Masked after saving.
              </p>
            </div>
          )}

          {/* Model Selection */}
          {selectedProvider && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-400">Model</Label>
              {!isCustom && currentProvider && currentProvider.models.length > 0 ? (
                <Select
                  value={model}
                  onValueChange={(v) => {
                    setModel(v);
                    setSaved(false);
                  }}
                >
                  <SelectTrigger className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 hover:border-zinc-600 transition-colors">
                    <SelectValue placeholder="Select a model..." />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {currentProvider.models.map((m) => (
                      <SelectItem
                        key={m}
                        value={m}
                        className="text-zinc-100 focus:bg-zinc-700 font-mono text-sm"
                      >
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
                  className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 font-mono text-sm hover:border-zinc-600 transition-colors"
                />
              )}
            </div>
          )}

          {/* Divider before advanced */}
          {selectedProvider && (
            <>
              <div className="border-t border-zinc-800/60" />
              <details className={isCustom ? 'open' : ''}>
                <summary className="text-sm text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none">
                  Advanced settings
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-400">Base URL</Label>
                    <Input
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setSaved(false);
                      }}
                      placeholder="https://api.example.com/v1"
                      className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 font-mono text-sm hover:border-zinc-600 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-zinc-400">API Type</Label>
                    <Select
                      value={apiType}
                      onValueChange={(v) => {
                        setApiType(v);
                        setSaved(false);
                      }}
                    >
                      <SelectTrigger className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 hover:border-zinc-600 transition-colors">
                        <SelectValue placeholder="Select API type..." />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem
                          value="openai-completions"
                          className="text-zinc-100 focus:bg-zinc-700"
                        >
                          OpenAI Completions (most providers)
                        </SelectItem>
                        <SelectItem
                          value="anthropic-messages"
                          className="text-zinc-100 focus:bg-zinc-700"
                        >
                          Anthropic Messages
                        </SelectItem>
                        <SelectItem
                          value="google-generative-ai"
                          className="text-zinc-100 focus:bg-zinc-700"
                        >
                          Google Generative AI
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-zinc-600">
                      OpenAI-compatible works for Groq, OpenRouter, Together, and most providers.
                    </p>
                  </div>
                </div>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save Button + Error */}
      {selectedProvider && (
        <div className="space-y-3">
          {saveError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{saveError}</p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || !selectedProvider || !apiKey}
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 transition-colors disabled:opacity-40"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Saved
                </>
              ) : (
                'Save Settings'
              )}
            </Button>
            {!apiKey && selectedProvider && (
              <span className="text-sm text-zinc-600">Enter an API key to save.</span>
            )}
          </div>
        </div>
      )}

      {/* Current Config Summary */}
      {selectedProvider && model && (
        <Card className="border-zinc-800/60 bg-zinc-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Active Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-zinc-600 text-xs">Provider</p>
                <p className="text-zinc-200 font-medium">
                  {currentProvider?.name ?? selectedProvider}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-zinc-600 text-xs">Model</p>
                <p className="text-zinc-200 font-mono text-xs">{model}</p>
              </div>
              <div className="space-y-1">
                <p className="text-zinc-600 text-xs">API Type</p>
                <p className="text-zinc-200">{apiType || 'openai-completions'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-zinc-600 text-xs">Base URL</p>
                <p className="text-zinc-200 font-mono text-xs truncate">{baseUrl || '\u2014'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
