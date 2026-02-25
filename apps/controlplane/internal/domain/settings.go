package domain

import "time"

// PlatformSettings holds the global configuration for the OpenSwarm platform.
type PlatformSettings struct {
	LLM       LLMSettings `json:"llm"`
	UpdatedAt time.Time   `json:"updatedAt,omitempty"`
}

// LLMSettings configures the LLM provider used by all OpenClaw instances.
type LLMSettings struct {
	Provider string `json:"provider"` // "groq", "openrouter", "google", "openai", "anthropic", "custom"
	APIKey   string `json:"apiKey"`   // API key for the provider
	BaseURL  string `json:"baseUrl"`  // Provider base URL (auto-set for known providers)
	Model    string `json:"model"`    // Default model ID e.g. "llama-3.3-70b-versatile"
	APIType  string `json:"apiType"`  // "openai-completions" (default), "anthropic-messages", "google-generative-ai"
}

// KnownProvider describes a pre-configured LLM provider.
type KnownProvider struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	BaseURL     string   `json:"baseUrl"`
	APIType     string   `json:"apiType"`
	Models      []string `json:"models"`
	SignupURL   string   `json:"signupUrl"`
	FreeKeyNote string   `json:"freeKeyNote"`
}

// KnownProviders lists pre-configured providers users can pick from the UI.
var KnownProviders = []KnownProvider{
	{
		ID:          "groq",
		Name:        "Groq",
		BaseURL:     "https://api.groq.com/openai/v1",
		APIType:     "openai-completions",
		Models:      []string{"llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"},
		SignupURL:   "https://console.groq.com",
		FreeKeyNote: "Free tier: 30 req/min, 14,400 req/day",
	},
	{
		ID:          "openrouter",
		Name:        "OpenRouter",
		BaseURL:     "https://openrouter.ai/api",
		APIType:     "openai-completions",
		Models:      []string{"meta-llama/llama-3.3-70b-instruct:free", "google/gemma-2-9b-it:free", "mistralai/mistral-7b-instruct:free"},
		SignupURL:   "https://openrouter.ai",
		FreeKeyNote: "Free models available, no credit card needed",
	},
	{
		ID:          "google",
		Name:        "Google Gemini",
		BaseURL:     "https://generativelanguage.googleapis.com/v1beta",
		APIType:     "google-generative-ai",
		Models:      []string{"gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"},
		SignupURL:   "https://aistudio.google.com/apikey",
		FreeKeyNote: "Free tier: 15 req/min, 1,500 req/day",
	},
	{
		ID:          "openai",
		Name:        "OpenAI",
		BaseURL:     "https://api.openai.com",
		APIType:     "openai-completions",
		Models:      []string{"gpt-4o-mini", "gpt-4o", "gpt-4-turbo"},
		SignupURL:   "https://platform.openai.com/api-keys",
		FreeKeyNote: "Paid — $5 minimum credit",
	},
	{
		ID:          "anthropic",
		Name:        "Anthropic",
		BaseURL:     "https://api.anthropic.com",
		APIType:     "anthropic-messages",
		Models:      []string{"claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"},
		SignupURL:   "https://console.anthropic.com",
		FreeKeyNote: "Paid — $5 minimum credit",
	},
	{
		ID:      "custom",
		Name:    "Custom / Self-hosted",
		BaseURL: "",
		APIType: "openai-completions",
		Models:  []string{},
	},
}
