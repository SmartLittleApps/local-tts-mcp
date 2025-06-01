import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TTSEngine, HealthStatus } from '../types/index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

export const healthCheckTool: Tool = {
  name: 'health_check',
  description: 'Check the health and availability of TTS engines',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function healthCheckHandler(
  params: unknown,
  engines: Map<string, TTSEngine>
): Promise<any> {
  try {
    const healthResults: HealthStatus[] = [];
    
    for (const [engineName, engine] of engines) {
      const startTime = Date.now();
      
      try {
        const isAvailable = await engine.isAvailable();
        const responseTime = Date.now() - startTime;
        
        if (isAvailable) {
          // Test basic functionality
          const testStart = Date.now();
          const voices = await engine.listVoices();
          const voiceLoadTime = Date.now() - testStart;
          
          healthResults.push({
            engine: engineName,
            available: true,
            performance: {
              averageSpeed: 0, // Would be calculated from historical data
              memoryUsage: process.memoryUsage().heapUsed,
              responseTime: responseTime + voiceLoadTime
            },
            lastTest: new Date()
          });
        } else {
          healthResults.push({
            engine: engineName,
            available: false,
            lastTest: new Date(),
            error: 'Engine not available on this system'
          });
        }
      } catch (error) {
        healthResults.push({
          engine: engineName,
          available: false,
          lastTest: new Date(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Get version from package.json
    let version = 'unknown';
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const packagePath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      version = packageJson.version;
    } catch (e) {
      // Fallback to env or default
      version = process.env.TTS_VERSION || '1.1.0';
    }

    const overallHealth = {
      timestamp: new Date().toISOString(),
      version: version,
      availableEngines: healthResults.filter(h => h.available).length,
      totalEngines: healthResults.length,
      systemInfo: {
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            overallHealth,
            engineHealth: healthResults
          }, null, 2)
        }
      ]
    };

  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Health check failed',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }
      ],
      isError: true
    };
  }
}