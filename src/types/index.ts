export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  description?: string;
  engine: 'macos' | 'kokoro' | 'coqui';
  quality: 'fast' | 'balanced' | 'high';
}

export interface SynthesisRequest {
  text: string;
  voice?: string;
  engine?: 'macos' | 'kokoro' | 'coqui' | 'auto';
  outputFormat?: 'wav' | 'mp3' | 'm4a' | 'aiff';
  speed?: number;
  quality?: 'fast' | 'balanced' | 'high';
}

export interface AudioResult {
  filePath: string;
  format: string;
  duration?: number;
  size: number;
  metadata: {
    voice: string;
    engine: string;
    textLength: number;
    synthesisTime: number;
  };
}

export interface TTSEngine {
  name: string;
  initialize(): Promise<void>;
  listVoices(): Promise<Voice[]>;
  synthesize(request: SynthesisRequest): Promise<AudioResult>;
  cleanup(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface EngineConfig {
  enabled: boolean;
  priority: number;
  maxConcurrent: number;
  memoryLimit: number;
  settings?: Record<string, unknown>;
}

export interface ServerConfig {
  outputDir: string;
  tempDir: string;
  defaultEngine: 'macos' | 'kokoro' | 'coqui' | 'auto';
  defaultQuality: 'fast' | 'balanced' | 'high';
  engines: {
    macos: EngineConfig;
    kokoro: EngineConfig;
    coqui: EngineConfig;
  };
}

export interface HealthStatus {
  engine: string;
  available: boolean;
  performance?: {
    averageSpeed: number;
    memoryUsage: number;
    responseTime: number;
  };
  lastTest?: Date;
  error?: string;
}

export interface BatchRequest {
  id: string;
  texts: Array<{
    id: string;
    text: string;
    voice?: string;
    outputName?: string;
  }>;
  globalSettings: Omit<SynthesisRequest, 'text'>;
}

export interface BatchProgress {
  id: string;
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  results: Array<{
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result?: AudioResult;
    error?: string;
  }>;
}

export class TTSError extends Error {
  constructor(
    message: string,
    public code: string,
    public engine?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TTSError';
  }
}

export const ErrorCodes = {
  ENGINE_NOT_AVAILABLE: 'ENGINE_NOT_AVAILABLE',
  ENGINE_NOT_INITIALIZED: 'ENGINE_NOT_INITIALIZED',
  ENGINE_INITIALIZATION_FAILED: 'ENGINE_INITIALIZATION_FAILED',
  VOICE_NOT_FOUND: 'VOICE_NOT_FOUND',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  SYNTHESIS_FAILED: 'SYNTHESIS_FAILED',
  FILE_OPERATION_FAILED: 'FILE_OPERATION_FAILED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  TIMEOUT: 'TIMEOUT',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
  PLAYBACK_FAILED: 'PLAYBACK_FAILED',
} as const;