#!/usr/bin/env node

/**
 * TextToSpeech MCP Server
 * 
 * A Model Context Protocol server that provides local text-to-speech synthesis
 * using macOS Say and Kokoro TTS engines optimized for M1 MacBook Pro.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import tool handlers
import { synthesizeTextHandler } from './tools/synthesize-text.js';
import { listVoicesHandler } from './tools/list-voices.js';
import { healthCheckHandler } from './tools/health-check.js';
import { playAudioHandler } from './tools/audio-player.js';

// Import engines
import { TTSEngine } from './types/index.js';
import { MacOSEngine } from './engines/macos-engine.js';
import { KokoroEngine } from './engines/kokoro-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Tool registry matching whisper-mcp pattern
const tools = {
  'synthesize_text': {
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
    },
    handler: synthesizeTextHandler
  },
  'list_voices': {
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
    },
    handler: listVoicesHandler
  },
  'health_check': {
    name: 'health_check',
    description: 'Check the health and availability of TTS engines',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: healthCheckHandler
  },
  'play_audio': {
    name: 'play_audio',
    description: 'Play, pause, resume, or stop audio playback of TTS generated files',
    inputSchema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: 'Path to audio file to play (defaults to most recent if not provided)'
        },
        action: {
          type: 'string',
          enum: ['play', 'pause', 'stop', 'resume'],
          description: 'Audio playback action',
          default: 'play'
        }
      },
      required: []
    },
    handler: playAudioHandler
  }
};

function getPackageVersion(): string {
  try {
    const packageJsonPath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '1.1.0';
  }
}

// Global engines map
let engines: Map<string, TTSEngine>;

/**
 * Initialize TTS engines
 */
async function initializeEngines(): Promise<Map<string, TTSEngine>> {
  const engineMap = new Map<string, TTSEngine>();
  
  // Use environment variables or fallback to user directories (working-directory independent)
  const outputDir = process.env.TTS_OUTPUT_DIR || join(process.env.HOME || '/tmp', 'TTS-Output');
  const tempDir = process.env.TTS_TEMP_DIR || join(process.env.HOME || '/tmp', 'TTS-Temp');
  
  // Debug logging for Claude Desktop environment
  console.error(`[DEBUG] outputDir: ${outputDir}`);
  console.error(`[DEBUG] tempDir: ${tempDir}`);
  console.error(`[DEBUG] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.error(`[DEBUG] PYTHONPATH: ${process.env.PYTHONPATH || 'not set'}`);
  console.error(`[DEBUG] PATH: ${process.env.PATH ? process.env.PATH.split(':').slice(0,3).join(':') + '...' : 'not set'}`);
  
  // Initialize macOS engine
  try {
    const macosEngine = new MacOSEngine(outputDir, tempDir);
    if (await macosEngine.isAvailable()) {
      await macosEngine.initialize();
      engineMap.set('macos', macosEngine);
      console.error('✓ macOS Say engine initialized');
    } else {
      console.error('⚠ macOS Say engine not available');
    }
  } catch (error) {
    console.error('✗ Failed to initialize macOS Say engine:', error);
  }

  // Initialize Kokoro engine (force attempt even in Claude Desktop)
  console.error('[DEBUG] Starting Kokoro engine initialization...');
  try {
    const kokoroEngine = new KokoroEngine(outputDir, tempDir);
    console.error('[DEBUG] Kokoro engine created, testing availability...');
    
    if (await kokoroEngine.isAvailable()) {
      console.error('[DEBUG] Kokoro available, initializing...');
      await kokoroEngine.initialize();
      engineMap.set('kokoro', kokoroEngine);
      console.error('✓ Kokoro TTS engine initialized');
    } else {
      console.error('⚠ Kokoro TTS engine not available (availability check failed)');
    }
  } catch (error) {
    console.error('✗ Failed to initialize Kokoro TTS engine:', error);
    console.error('✗ Error stack:', error instanceof Error ? error.stack : 'No stack');
  }

  if (engineMap.size === 0) {
    console.error('⚠ No TTS engines available');
  } else {
    console.error(`✓ TTS MCP Server initialized with ${engineMap.size} engine(s)`);
  }

  return engineMap;
}

/**
 * Create and configure the MCP server
 */
function createServer() {
  const version = getPackageVersion();
  const server = new Server(
    {
      name: 'local-tts',
      version: version
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Error handling
  server.onerror = (error) => console.error('[MCP Error]', error);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.values(tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    const tool = tools[name as keyof typeof tools];
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      // Execute tool with provided arguments and engines
      const result = await tool.handler(args as any, engines);
      
      // Ensure result is in proper MCP format
      if (typeof result === 'string') {
        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      }
      
      return result;
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return server;
}

/**
 * Main function
 */
async function main() {
  try {
    // Initialize engines
    engines = await initializeEngines();
    
    // Create server
    const server = createServer();
    
    // Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('TTS MCP Server running on stdio');
    
  } catch (error) {
    console.error('Failed to start TTS MCP Server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('\nShutting down...');
  if (engines) {
    for (const engine of engines.values()) {
      try {
        await engine.cleanup();
      } catch (error) {
        console.error('Error during engine cleanup:', error);
      }
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\nShutting down...');
  if (engines) {
    for (const engine of engines.values()) {
      try {
        await engine.cleanup();
      } catch (error) {
        console.error('Error during engine cleanup:', error);
      }
    }
  }
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}