import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TTSEngine, Voice } from '../types/index.js';

export const listVoicesSchema = z.object({
  engine: z.enum(['macos', 'kokoro', 'all']).optional().default('all'),
  language: z.string().optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional()
});

export type ListVoicesParams = z.infer<typeof listVoicesSchema>;

export const listVoicesTool: Tool = {
  name: 'list_voices',
  description: 'List available voices from TTS engines with filtering options',
  inputSchema: {
    type: 'object',
    properties: {
      engine: {
        type: 'string',
        enum: ['macos', 'kokoro', 'all'],
        description: 'Filter by TTS engine (all shows voices from all engines)',
        default: 'all'
      },
      language: {
        type: 'string',
        description: 'Filter by language code (e.g., "en-us", "es", "fr")'
      },
      gender: {
        type: 'string',
        enum: ['male', 'female', 'neutral'],
        description: 'Filter by voice gender'
      }
    },
    required: []
  }
};

export async function listVoicesHandler(
  params: unknown,
  engines: Map<string, TTSEngine>
): Promise<any> {
  try {
    const validatedParams = listVoicesSchema.parse(params);
    
    let allVoices: Voice[] = [];
    
    // Collect voices from requested engines
    for (const [engineName, engine] of engines) {
      if (validatedParams.engine === 'all' || validatedParams.engine === engineName) {
        try {
          const voices = await engine.listVoices();
          allVoices.push(...voices);
        } catch (error) {
          console.warn(`Failed to get voices from ${engineName} engine:`, error);
        }
      }
    }

    // Apply filters
    let filteredVoices = allVoices;

    if (validatedParams.language) {
      const targetLang = validatedParams.language.toLowerCase();
      filteredVoices = filteredVoices.filter(voice => 
        voice.language.toLowerCase().includes(targetLang) ||
        voice.language.toLowerCase().startsWith(targetLang.split('-')[0])
      );
    }

    if (validatedParams.gender) {
      filteredVoices = filteredVoices.filter(voice => 
        voice.gender === validatedParams.gender
      );
    }

    // Sort voices by engine, then by name
    filteredVoices.sort((a, b) => {
      if (a.engine !== b.engine) {
        return a.engine.localeCompare(b.engine);
      }
      return a.name.localeCompare(b.name);
    });

    // Group by engine for better presentation
    const voicesByEngine = filteredVoices.reduce((acc, voice) => {
      if (!acc[voice.engine]) {
        acc[voice.engine] = [];
      }
      acc[voice.engine].push(voice);
      return acc;
    }, {} as Record<string, Voice[]>);

    const summary = {
      totalVoices: filteredVoices.length,
      availableEngines: Object.keys(voicesByEngine),
      languages: [...new Set(filteredVoices.map(v => v.language))].sort(),
      genders: [...new Set(filteredVoices.map(v => v.gender).filter(Boolean))].sort()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            summary,
            voicesByEngine,
            filters: validatedParams
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Failed to list voices',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }
      ],
      isError: true
    };
  }
}