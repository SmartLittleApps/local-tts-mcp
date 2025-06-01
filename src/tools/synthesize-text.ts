import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SynthesisRequest, TTSEngine, TTSError, ErrorCodes } from '../types/index.js';
import { audioPlayer } from './audio-player.js';

export const synthesizeTextSchema = z.object({
  text: z.string().min(1).max(50000),
  voice: z.string().optional(),
  engine: z.enum(['macos', 'kokoro', 'auto']).optional().default('auto'),
  outputFormat: z.enum(['wav', 'mp3', 'm4a', 'aiff']).optional().default('aiff'),
  speed: z.number().min(0.1).max(3.0).optional().default(1.0),
  quality: z.enum(['fast', 'balanced', 'high']).optional().default('balanced')
});

export type SynthesizeTextParams = z.infer<typeof synthesizeTextSchema>;

export const synthesizeTextTool: Tool = {
  name: 'synthesize_text',
  description: 'Convert text to speech using local TTS engines (macOS Say or Kokoro TTS)',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to convert to speech (max 50,000 characters)',
        minLength: 1,
        maxLength: 50000
      },
      voice: {
        type: 'string',
        description: 'Voice to use for synthesis (optional, uses default if not specified)'
      },
      engine: {
        type: 'string',
        enum: ['macos', 'kokoro', 'auto'],
        description: 'TTS engine to use (auto selects best engine for the request)',
        default: 'auto'
      },
      outputFormat: {
        type: 'string',
        enum: ['wav', 'mp3', 'm4a', 'aiff'],
        description: 'Audio output format',
        default: 'aiff'
      },
      speed: {
        type: 'number',
        minimum: 0.1,
        maximum: 3.0,
        description: 'Speech speed multiplier (1.0 = normal speed)',
        default: 1.0
      },
      quality: {
        type: 'string',
        enum: ['fast', 'balanced', 'high'],
        description: 'Synthesis quality vs speed trade-off',
        default: 'balanced'
      }
    },
    required: ['text']
  }
};

export async function synthesizeTextHandler(
  params: unknown,
  engines: Map<string, TTSEngine>
): Promise<any> {
  try {
    const validatedParams = synthesizeTextSchema.parse(params);
    
    const engine = selectEngine(validatedParams.engine, engines);
    if (!engine) {
      throw new TTSError(
        'No available TTS engines',
        ErrorCodes.ENGINE_NOT_AVAILABLE
      );
    }

    const request: SynthesisRequest = {
      text: validatedParams.text,
      voice: validatedParams.voice,
      engine: engine.name as 'macos' | 'kokoro',
      outputFormat: validatedParams.outputFormat,
      speed: validatedParams.speed,
      quality: validatedParams.quality
    };

    const result = await engine.synthesize(request);

    // Track the most recent file for audio player
    audioPlayer.setMostRecentFile(result.filePath);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            result: {
              filePath: result.filePath,
              format: result.format,
              duration: result.duration,
              size: result.size,
              metadata: result.metadata
            },
            playback: 'Use play_audio tool to play this file'
          }, null, 2)
        }
      ]
    };

  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Invalid parameters',
              details: error.errors
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    if (error instanceof TTSError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              code: error.code,
              engine: error.engine
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Internal server error',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }
      ],
      isError: true
    };
  }
}

function selectEngine(
  preference: 'macos' | 'kokoro' | 'auto',
  engines: Map<string, TTSEngine>
): TTSEngine | null {
  if (preference === 'macos') {
    return engines.get('macos') || null;
  }
  
  if (preference === 'kokoro') {
    return engines.get('kokoro') || null;
  }

  // Auto selection: prefer Kokoro for quality, fallback to macOS for speed
  return engines.get('kokoro') || engines.get('macos') || null;
}