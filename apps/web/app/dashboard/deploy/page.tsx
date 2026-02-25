'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode2,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';
import { validateSwarmYAML, deploySwarmFromYAML } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// YAML Templates
// ---------------------------------------------------------------------------

const HELLO_SWARM_YAML = `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: hello-swarm
  labels:
    env: demo

spec:
  defaults:
    model: groq/meta-llama/llama-4-scout-17b-16e-instruct
    config:
      temperature: 0.7
      maxTokens: 4096
      contextWindow: 131072

  budget:
    total: '$1.00'
    alertAt: 80
    hardStop: 100

  agents:
    - name: greeter
      replicas: { min: 1, max: 1 }
      soul: |
        You are a friendly greeter agent.

    - name: formatter
      replicas: { min: 1, max: 1 }
      soul: |
        You are a formatter agent.
      config:
        temperature: 0.5
      dependsOn: [greeter]

  topology:
    - from: greeter
      to: formatter
      subject: greeting.raw`;

const CUSTOMER_SUPPORT_YAML = `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: customer-support
  labels:
    team: support

spec:
  defaults:
    model: groq/meta-llama/llama-4-scout-17b-16e-instruct
    config:
      temperature: 0.7
      maxTokens: 4096
      contextWindow: 131072

  budget:
    total: "$10.00"
    perTask: "$0.50"
    alertAt: 80
    hardStop: 100

  agents:
    - name: triage
      replicas: { min: 1, max: 3 }
      soul: |
        You are a triage agent. Classify and route messages.
      tools: [sessions_send, sessions_list]
      config:
        temperature: 0.5

    - name: resolver
      replicas: { min: 2, max: 5 }
      soul: |
        You are a resolver. Handle complaints with empathy.
      config:
        maxTokens: 8192
        temperature: 0.3

    - name: notifier
      replicas: { min: 1, max: 1 }
      model: groq/llama-3.3-70b-versatile
      soul: |
        You deliver case summaries.

  topology:
    - from: triage
      to: resolver
      subject: route.resolve
    - from: resolver
      to: notifier
      subject: route.notify`;

interface TemplateOption {
  value: string;
  label: string;
  description: string;
  yaml: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    value: 'hello-swarm',
    label: 'Hello Swarm',
    description: '2-agent demo pipeline (greeter + formatter)',
    yaml: HELLO_SWARM_YAML,
  },
  {
    value: 'customer-support',
    label: 'Customer Support',
    description: '3-agent support pipeline (triage + resolver + notifier)',
    yaml: CUSTOMER_SUPPORT_YAML,
  },
];

// ---------------------------------------------------------------------------
// Status message types
// ---------------------------------------------------------------------------

type MessageKind = 'success' | 'error' | 'info';

interface StatusMessage {
  kind: MessageKind;
  text: string;
}

// ---------------------------------------------------------------------------
// Deploy Page
// ---------------------------------------------------------------------------

export default function DeployPage(): React.JSX.Element {
  const [yaml, setYaml] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [validating, setValidating] = useState<boolean>(false);
  const [deploying, setDeploying] = useState<boolean>(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [deployed, setDeployed] = useState<boolean>(false);

  function handleTemplateChange(value: string): void {
    setSelectedTemplate(value);
    setStatus(null);
    setDeployed(false);

    const template = TEMPLATES.find((t) => t.value === value);
    if (template) {
      setYaml(template.yaml);
    }
  }

  async function handleValidate(): Promise<void> {
    if (!yaml.trim()) {
      setStatus({ kind: 'error', text: 'Please enter YAML content before validating.' });
      return;
    }

    try {
      setValidating(true);
      setStatus(null);

      const result = await validateSwarmYAML(yaml);

      if (result.valid === 'true' || result.valid === 'yes') {
        setStatus({ kind: 'success', text: 'YAML is valid and ready to deploy.' });
      } else {
        setStatus({
          kind: 'error',
          text: result.error ?? 'Validation failed. Check your YAML syntax.',
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Validation request failed. Is the control plane running?';
      setStatus({ kind: 'error', text: message });
    } finally {
      setValidating(false);
    }
  }

  async function handleDeploy(): Promise<void> {
    if (!yaml.trim()) {
      setStatus({ kind: 'error', text: 'Please enter YAML content before deploying.' });
      return;
    }

    try {
      setDeploying(true);
      setStatus(null);

      const res = await deploySwarmFromYAML(yaml);

      if (res.ok) {
        setStatus({ kind: 'success', text: 'Swarm deployed successfully!' });
        setDeployed(true);
      } else {
        const body = await res.text();
        setStatus({
          kind: 'error',
          text: `Deploy failed (${String(res.status)}): ${body}`,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Deploy request failed. Is the control plane running?';
      setStatus({ kind: 'error', text: message });
    } finally {
      setDeploying(false);
    }
  }

  const isLoading = validating || deploying;

  return (
    <div className="container py-10 max-w-3xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-500/10">
            <Rocket className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          Deploy Swarm
        </h1>
        <p className="text-sm text-zinc-500">
          Paste or select a swarm YAML manifest, validate it, and deploy to the control plane.
        </p>
      </div>

      {/* Template Selector */}
      <Card className="border-zinc-800/80 bg-zinc-900/60 shadow-lg shadow-black/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-zinc-400" />
            YAML Manifest
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Start from a template or paste your own swarm definition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Template Dropdown */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-400">Load Template</label>
            <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
              <SelectTrigger className="h-11 bg-zinc-800/80 border-zinc-700/60 text-zinc-100 hover:border-zinc-600 transition-colors">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {TEMPLATES.map((t) => (
                  <SelectItem
                    key={t.value}
                    value={t.value}
                    className="text-zinc-100 focus:bg-zinc-700"
                  >
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-xs text-zinc-500">{t.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* YAML Editor */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-400">Swarm YAML</label>
            <Textarea
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setStatus(null);
                setDeployed(false);
              }}
              placeholder={`apiVersion: openswarm/v1alpha1\nkind: Swarm\nmetadata:\n  name: my-swarm\n...\n`}
              rows={20}
              className="min-h-[400px] bg-zinc-950 border-zinc-700/60 text-zinc-100 font-mono text-sm leading-relaxed resize-y hover:border-zinc-600 transition-colors placeholder:text-zinc-700"
              spellCheck={false}
            />
            <p className="text-xs text-zinc-600">
              Supports{' '}
              <code className="bg-zinc-800 px-1 py-0.5 rounded text-zinc-400">
                openswarm/v1alpha1
              </code>{' '}
              manifests. See the docs for the full schema reference.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Status Message */}
      {status && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            status.kind === 'success'
              ? 'border-emerald-800/40 bg-emerald-950/20'
              : status.kind === 'error'
                ? 'border-red-800/40 bg-red-950/20'
                : 'border-zinc-800/40 bg-zinc-900/20'
          }`}
        >
          {status.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          )}
          <p
            className={`text-sm ${status.kind === 'success' ? 'text-emerald-300' : 'text-red-300'}`}
          >
            {status.text}
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleValidate}
          disabled={isLoading || !yaml.trim()}
          variant="outline"
          size="lg"
          className="border-zinc-700 bg-zinc-800/50 text-zinc-100 hover:bg-zinc-700/80 hover:text-zinc-50 font-medium px-6 transition-colors disabled:opacity-40"
        >
          {validating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Validating...
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 mr-2" />
              Validate
            </>
          )}
        </Button>

        <Button
          onClick={handleDeploy}
          disabled={isLoading || !yaml.trim()}
          size="lg"
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 transition-colors disabled:opacity-40"
        >
          {deploying ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4 mr-2" />
              Deploy
            </>
          )}
        </Button>

        {!yaml.trim() && (
          <span className="text-sm text-zinc-600">
            Select a template or paste YAML to get started.
          </span>
        )}
      </div>

      {/* Post-deploy link */}
      {deployed && (
        <Card className="border-emerald-800/40 bg-emerald-950/10">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-emerald-300 font-medium">
                Your swarm is being provisioned.
              </p>
              <p className="text-xs text-emerald-400/60 mt-0.5">
                Head back to the dashboard to monitor its status.
              </p>
            </div>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
