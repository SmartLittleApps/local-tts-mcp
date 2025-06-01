import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TTSEngine, Voice, SynthesisRequest, AudioResult, TTSError, ErrorCodes } from '../types/index.js';

const execAsync = promisify(exec);

export class MacOSEngine implements TTSEngine {
  public readonly name = 'macos';
  private voices: Voice[] = [];
  private initialized = false;
  private outputDir: string;
  private tempDir: string;

  constructor(outputDir: string, tempDir: string) {
    this.outputDir = outputDir;
    this.tempDir = tempDir;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (process.platform !== 'darwin') {
      throw new TTSError(
        'macOS Say engine is only available on macOS',
        ErrorCodes.ENGINE_NOT_AVAILABLE,
        this.name
      );
    }

    try {
      await execAsync('which say');
      await this.loadVoices();
      this.initialized = true;
    } catch (error) {
      throw new TTSError(
        'macOS Say command not available',
        ErrorCodes.ENGINE_NOT_AVAILABLE,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (process.platform !== 'darwin') return false;
      await execAsync('which say');
      return true;
    } catch {
      return false;
    }
  }

  private async loadVoices(): Promise<void> {
    try {
      const { stdout } = await execAsync('say -v "?"');
      this.voices = this.parseVoices(stdout);
    } catch (error) {
      throw new TTSError(
        'Failed to load macOS voices',
        ErrorCodes.ENGINE_NOT_AVAILABLE,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private parseVoices(output: string): Voice[] {
    const voices: Voice[] = [];
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const match = line.match(/^(\S+)\s+([a-z]{2}_[A-Z]{2})\s*#\s*(.*)$/);
      if (match) {
        const [, name, locale, description] = match;
        
        const gender = this.inferGender(name, description);
        const language = locale.toLowerCase().replace('_', '-');
        
        voices.push({
          id: `macos-${name.toLowerCase()}`,
          name,
          language,
          gender,
          description: description.trim(),
          engine: 'macos',
          quality: 'balanced'
        });
      }
    }

    return voices;
  }

  private inferGender(name: string, description: string): 'male' | 'female' | 'neutral' {
    const lowerName = name.toLowerCase();
    const lowerDesc = description.toLowerCase();
    
    const maleIndicators = ['male', 'man', 'masculine', 'alex', 'daniel', 'fred', 'jorge', 'juan', 'diego', 'thomas', 'jacques', 'xander'];
    const femaleIndicators = ['female', 'woman', 'feminine', 'allison', 'ava', 'kate', 'kathy', 'samantha', 'susan', 'tessa', 'victoria', 'karen', 'monica', 'paulina', 'alice', 'amélie', 'anna', 'ellen', 'joana', 'luciana'];
    
    if (maleIndicators.some(indicator => lowerName.includes(indicator) || lowerDesc.includes(indicator))) {
      return 'male';
    }
    if (femaleIndicators.some(indicator => lowerName.includes(indicator) || lowerDesc.includes(indicator))) {
      return 'female';
    }
    
    return 'neutral';
  }

  async listVoices(): Promise<Voice[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return [...this.voices];
  }

  async synthesize(request: SynthesisRequest): Promise<AudioResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!request.text || request.text.trim().length === 0) {
      throw new TTSError(
        'Text cannot be empty',
        ErrorCodes.INVALID_PARAMETERS,
        this.name
      );
    }

    if (request.text.length > 50000) {
      throw new TTSError(
        'Text too long for macOS Say (max 50,000 characters)',
        ErrorCodes.TEXT_TOO_LONG,
        this.name
      );
    }

    const startTime = Date.now();
    const voice = this.resolveVoice(request.voice);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const textPreview = request.text.slice(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
    const filename = `macos_${voice.name}_${timestamp}_${textPreview}.aiff`;
    const outputPath = path.join(this.outputDir, filename);

    try {
      await this.ensureDirectoryExists(this.outputDir);
      const rate = this.calculateRate(request.speed);

      const args = [
        '-v', voice.name,
        '-r', rate.toString(),
        '-o', outputPath,
        request.text
      ];

      await this.executeSay(args);

      const stats = await fs.stat(outputPath);
      const synthesisTime = Date.now() - startTime;

      return {
        filePath: outputPath,
        format: 'aiff',
        size: stats.size,
        metadata: {
          voice: voice.name,
          engine: this.name,
          textLength: request.text.length,
          synthesisTime
        }
      };

    } catch (error) {
      try {
        await fs.unlink(outputPath);
      } catch {
        // Ignore cleanup errors
      }
      
      if (error instanceof TTSError) {
        throw error;
      }
      
      throw new TTSError(
        'Synthesis failed',
        ErrorCodes.SYNTHESIS_FAILED,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private resolveVoice(requestedVoice?: string): Voice {
    if (!requestedVoice) {
      return this.voices.find(v => v.name === 'Alex') || this.voices[0];
    }

    const voice = this.voices.find(v => 
      v.name.toLowerCase() === requestedVoice.toLowerCase() ||
      v.id.toLowerCase() === requestedVoice.toLowerCase()
    );

    if (!voice) {
      throw new TTSError(
        `Voice "${requestedVoice}" not found`,
        ErrorCodes.VOICE_NOT_FOUND,
        this.name
      );
    }

    return voice;
  }

  private calculateRate(speed?: number): number {
    if (!speed) return 200;
    
    const rate = Math.round(speed * 200);
    return Math.max(80, Math.min(400, rate));
  }

  private async executeSay(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('say', args);
      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`say command failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
          reject(new TTSError(
            'Synthesis timeout',
            ErrorCodes.TIMEOUT,
            this.name
          ));
        }
      }, 300000); // 5 minute timeout
    });
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new TTSError(
        `Failed to create directory: ${dir}`,
        ErrorCodes.FILE_OPERATION_FAILED,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
    this.voices = [];
  }
}