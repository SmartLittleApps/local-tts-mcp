import { execa } from 'execa';
import stripAnsi from 'strip-ansi';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { TTSEngine, Voice, SynthesisRequest, AudioResult, TTSError, ErrorCodes } from '../types/index.js';

export class KokoroEngine implements TTSEngine {
  public readonly name = 'kokoro';
  private voices: Voice[] = [];
  private initialized = false;
  private outputDir: string;
  private tempDir: string;
  private modelPath?: string;
  private pythonExecutable?: string;
  private pythonEnvironment?: NodeJS.ProcessEnv;

  constructor(outputDir: string, tempDir: string) {
    this.outputDir = outputDir;
    this.tempDir = tempDir;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.error('[Kokoro] Starting initialization...');
    
    try {
      // Detect and configure Python environment
      console.error('[Kokoro] Step 1: Detecting Python environment...');
      await this.detectPythonEnvironment();
      console.error(`[Kokoro] Step 1 complete - Using Python: ${this.pythonExecutable}`);
      
      console.error('[Kokoro] Step 2: Loading voices...');
      await this.loadVoices();
      console.error(`[Kokoro] Step 2 complete - Loaded ${this.voices.length} voices`);
      
      this.initialized = true;
      console.error('[Kokoro] ✓ Initialization successful');
    } catch (error) {
      console.error(`[Kokoro] ✗ Initialization failed at step:`, error);
      console.error(`[Kokoro] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      
      // Don't throw - let the engine be unavailable but don't crash the server
      console.error('[Kokoro] Engine will be marked as unavailable');
      return;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      console.error('[Kokoro] [EXECA] Checking availability...');
      
      // Test Python availability first
      const pythonResult = await this.checkPythonAvailability();
      if (!pythonResult.success) {
        console.error(`[Kokoro] [EXECA] Python check failed: ${pythonResult.error}`);
        return false;
      }
      
      console.error(`[Kokoro] [EXECA] Python available: ${pythonResult.executable}`);
      
      // Test Kokoro import
      const kokoroResult = await this.checkKokoroImport(pythonResult.executable!);
      if (!kokoroResult.success) {
        console.error(`[Kokoro] [EXECA] Kokoro import failed: ${kokoroResult.error}`);
        console.error(`[Kokoro] [EXECA] STDERR: ${kokoroResult.stderr}`);
        return false;
      }
      
      console.error('[Kokoro] [EXECA] ✓ Availability check passed');
      return true;
    } catch (error) {
      console.error(`[Kokoro] [EXECA] ✗ Availability check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async detectPythonEnvironment(): Promise<void> {
    console.error('[Kokoro] Detecting Python environment...');
    
    try {
      // Try to find Python executable
      this.pythonExecutable = await this.findPythonExecutable();
      console.error(`[Kokoro] Found Python executable: ${this.pythonExecutable}`);
      
      // Set up environment variables
      this.pythonEnvironment = {
        ...process.env,
        // Inherit Claude Desktop environment if available
        ...(process.env.PYTHONPATH && { PYTHONPATH: process.env.PYTHONPATH }),
        ...(process.env.PATH && { PATH: process.env.PATH }),
      };
      
      // Verify Kokoro package installation
      await this.verifyKokoroInstallation();
      console.error('[Kokoro] Python environment detection complete');
      
    } catch (error) {
      console.error('[Kokoro] Python environment detection failed:', error);
      throw new TTSError(
        `Failed to detect Python environment: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.ENGINE_NOT_AVAILABLE,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async findPythonExecutable(): Promise<string> {
    // HARDCODED APPROACH: Use known working Python path first (MCP server best practice)
    const KNOWN_WORKING_PYTHON = '/opt/miniconda3/bin/python3';
    
    console.error(`[Kokoro] Trying known working Python: ${KNOWN_WORKING_PYTHON}`);
    try {
      await this.testPythonExecutable(KNOWN_WORKING_PYTHON);
      console.error(`[Kokoro] Success: Using hardcoded Python path`);
      return KNOWN_WORKING_PYTHON;
    } catch (error) {
      console.error(`[Kokoro] Hardcoded Python failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Try explicit PYTHON_EXECUTABLE from environment as backup
    if (process.env.PYTHON_EXECUTABLE) {
      console.error(`[Kokoro] Trying PYTHON_EXECUTABLE: ${process.env.PYTHON_EXECUTABLE}`);
      try {
        await this.testPythonExecutable(process.env.PYTHON_EXECUTABLE);
        return process.env.PYTHON_EXECUTABLE;
      } catch (error) {
        console.error(`[Kokoro] Environment Python failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Final fallback to standard detection
    const candidates = ['python3', '/opt/homebrew/bin/python3', '/usr/bin/python3'];
    console.error(`[Kokoro] Fallback detection: ${candidates.join(', ')}`);
    
    for (const candidate of candidates) {
      try {
        await this.testPythonExecutable(candidate);
        return candidate;
      } catch (error) {
        console.error(`[Kokoro] Failed: ${candidate}`);
      }
    }
    
    throw new Error(`No Python executable works. Install miniconda3 at /opt/miniconda3/ or set PYTHON_EXECUTABLE.`);
  }

  private async testPythonExecutable(executable: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(executable, ['--version']);
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python executable ${executable} failed`));
        }
      });
      
      process.on('error', (error) => {
        reject(error);
      });
      
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
          reject(new Error(`Python executable ${executable} timeout`));
        }
      }, 5000);
    });
  }

  private async verifyKokoroInstallation(): Promise<void> {
    const checkScript = `
import sys
import os
try:
    import kokoro
    print(f"Kokoro version: {kokoro.__version__ if hasattr(kokoro, '__version__') else 'unknown'}")
    print(f"Python executable: {sys.executable}")
    print(f"Python version: {sys.version}")
    print(f"PYTHONPATH: {os.environ.get('PYTHONPATH', 'Not set')}")
    print("SUCCESS: Kokoro package verification complete")
    sys.exit(0)
except ImportError as e:
    print(f"ERROR: Missing Kokoro package: {e}")
    print("Install with: pip install kokoro==0.8.4 soundfile")
    print("Also install: brew install espeak-ng")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: Kokoro verification failed: {e}")
    sys.exit(1)
`;

    return new Promise((resolve, reject) => {
      if (!this.pythonExecutable) {
        reject(new Error('Python executable not detected'));
        return;
      }

      const process = spawn(this.pythonExecutable, ['-c', checkScript], {
        env: this.pythonEnvironment
      });
      
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.error(`[Kokoro Verify] ${output.trim()}`);
      });

      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error(`[Kokoro Verify Error] ${output.trim()}`);
      });

      process.on('close', (code) => {
        if (code === 0 && stdout.includes('SUCCESS')) {
          resolve();
        } else {
          reject(new Error(`Kokoro verification failed (code ${code}): ${stderr || stdout}`));
        }
      });

      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
          reject(new Error('Kokoro verification timeout'));
        }
      }, 30000);
    });
  }

  private async testKokoroWithPython(pythonExecutable: string): Promise<void> {
    // Simple test - just verify the kokoro package can be imported
    const checkScript = `
import sys
import os
# Ensure Python can find packages
sys.path.insert(0, '/opt/miniconda3/lib/python3.12/site-packages')
try:
    import kokoro
    print("Kokoro available")
    sys.exit(0)
except ImportError as e:
    print(f"Import error: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Other error: {e}", file=sys.stderr)
    sys.exit(1)
`;

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        // Ensure critical Python environment variables are set
        PYTHONPATH: process.env.PYTHONPATH || '',
        PATH: process.env.PATH || '/usr/bin:/bin',
        // Add any additional Python environment variables that might be needed
        PYTHONHOME: process.env.PYTHONHOME || '',
        PYTHONEXECUTABLE: pythonExecutable,
        // Ensure locale is set properly
        LC_ALL: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8'
      };
      
      console.error(`[Kokoro] Testing availability with env: PYTHONPATH=${env.PYTHONPATH || 'unset'}`);
      const childProcess = spawn(pythonExecutable, ['-c', checkScript], { env });
      
      let stdout = '';
      let stderr = '';
      
      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      childProcess.on('close', (code) => {
        console.error(`[Kokoro] Availability test completed: code=${code}, stdout="${stdout.trim()}", stderr="${stderr.trim()}"`);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Kokoro not available with ${pythonExecutable}: ${stderr || stdout}`));
        }
      });

      childProcess.on('error', (error) => {
        console.error(`[Kokoro] Availability test spawn error: ${error.message}`);
        reject(error);
      });

      setTimeout(() => {
        if (!childProcess.killed) {
          console.error('[Kokoro] Availability test timeout, killing process');
          childProcess.kill('SIGTERM');
          reject(new Error('Kokoro availability check timeout'));
        }
      }, 30000);
    });
  }

  // New execa-based methods for reliable subprocess execution
  private async checkPythonAvailability(): Promise<{success: boolean, executable?: string, error?: string}> {
    const pythonCandidates = [
      '/opt/miniconda3/bin/python3',
      'python3',
      'python',
      '/usr/bin/python3',
      '/opt/homebrew/bin/python3'
    ];

    for (const python of pythonCandidates) {
      try {
        console.error(`[Kokoro] [EXECA] Testing Python: ${python}`);
        const result = await execa(python, ['--version'], {
          timeout: 5000,
          reject: false,
          encoding: 'utf8',
          env: this.buildEnvironment()
        });

        if (result.exitCode === 0) {
          console.error(`[Kokoro] [EXECA] Python found: ${python} - ${stripAnsi(result.stdout.trim())}`);
          return { success: true, executable: python };
        }
      } catch (error) {
        console.error(`[Kokoro] [EXECA] Python test failed for ${python}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    return { success: false, error: 'No working Python executable found' };
  }

  private async checkKokoroImport(pythonExecutable: string): Promise<{success: boolean, error?: string, stderr?: string}> {
    const importScript = `
import sys
try:
    import kokoro
    print("Kokoro import successful")
    sys.exit(0)
except ImportError as e:
    print(f"Import error: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Other error: {e}", file=sys.stderr)
    sys.exit(1)
`;

    try {
      console.error(`[Kokoro] [EXECA] Testing Kokoro import with: ${pythonExecutable}`);
      const result = await execa(pythonExecutable, ['-c', importScript], {
        timeout: 30000,
        reject: false,
        encoding: 'utf8',
        env: this.buildEnvironment()
      });

      console.error(`[Kokoro] [EXECA] Import test completed: exitCode=${result.exitCode}`);
      console.error(`[Kokoro] [EXECA] STDOUT: ${stripAnsi(result.stdout || '').trim()}`);
      console.error(`[Kokoro] [EXECA] STDERR: ${stripAnsi(result.stderr || '').trim()}`);

      if (result.exitCode === 0) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: `Exit code ${result.exitCode}`,
          stderr: stripAnsi(result.stderr || '')
        };
      }
    } catch (error) {
      console.error(`[Kokoro] [EXECA] Import test exception: ${error instanceof Error ? error.message : String(error)}`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // Python-specific variables
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONWARNINGS: 'ignore',
      
      // Ensure critical paths are available - inherit existing PYTHONPATH, don't override
      ...(process.env.PYTHONPATH && { PYTHONPATH: process.env.PYTHONPATH }),
      PATH: process.env.PATH || '/opt/miniconda3/bin:/usr/bin:/bin',
      
      // Claude Desktop specific - inherit user environment
      HOME: process.env.HOME || '',
      USER: process.env.USER || '',
      
      // Locale
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8'
    };
  }

  private async checkKokoroAvailability(): Promise<void> {
    // Check if Kokoro TTS and required dependencies are available
    const checkScript = `
import sys
try:
    import numpy as np
    import scipy.io.wavfile
    import kokoro
    print("Kokoro TTS and dependencies available")
    sys.exit(0)
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("To install: pip install kokoro==0.8.4 soundfile")
    print("Also install: brew install espeak-ng  # or apt-get install espeak-ng")
    sys.exit(1)
`;

    return new Promise((resolve, reject) => {
      const process = spawn('python3', ['-c', checkScript]);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && stdout.includes('Kokoro TTS and dependencies available')) {
          resolve();
        } else {
          reject(new Error(`Kokoro TTS not available: ${stderr || stdout}`));
        }
      });

      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGTERM');
          reject(new Error('Dependency check timeout'));
        }
      }, 10000);
    });
  }

  private async loadVoices(): Promise<void> {
    // Kokoro TTS voice catalog - 54 voices across 8 languages
    this.voices = [
      // English voices
      { id: 'kokoro-af', name: 'AF (American Female)', language: 'en-us', gender: 'female', description: 'Young American female voice', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-af_bella', name: 'AF_BELLA', language: 'en-us', gender: 'female', description: 'Bella - warm American female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-af_sarah', name: 'AF_SARAH', language: 'en-us', gender: 'female', description: 'Sarah - clear American female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-am_adam', name: 'AM_ADAM', language: 'en-us', gender: 'male', description: 'Adam - deep American male', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-am_michael', name: 'AM_MICHAEL', language: 'en-us', gender: 'male', description: 'Michael - natural American male', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-bf_emma', name: 'BF_EMMA', language: 'en-gb', gender: 'female', description: 'Emma - British female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-bm_george', name: 'BM_GEORGE', language: 'en-gb', gender: 'male', description: 'George - British male', engine: 'kokoro', quality: 'high' },
      
      // Spanish voices
      { id: 'kokoro-es_am_antonio', name: 'ES_AM_ANTONIO', language: 'es-es', gender: 'male', description: 'Antonio - Spanish male', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-es_af_maria', name: 'ES_AF_MARIA', language: 'es-es', gender: 'female', description: 'Maria - Spanish female', engine: 'kokoro', quality: 'high' },
      
      // French voices
      { id: 'kokoro-fr_am_pierre', name: 'FR_AM_PIERRE', language: 'fr-fr', gender: 'male', description: 'Pierre - French male', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-fr_af_sophie', name: 'FR_AF_SOPHIE', language: 'fr-fr', gender: 'female', description: 'Sophie - French female', engine: 'kokoro', quality: 'high' },
      
      // Japanese voices
      { id: 'kokoro-ja_af_yuki', name: 'JA_AF_YUKI', language: 'ja-jp', gender: 'female', description: 'Yuki - Japanese female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-ja_am_hiroshi', name: 'JA_AM_HIROSHI', language: 'ja-jp', gender: 'male', description: 'Hiroshi - Japanese male', engine: 'kokoro', quality: 'high' },
      
      // German voices  
      { id: 'kokoro-de_af_anna', name: 'DE_AF_ANNA', language: 'de-de', gender: 'female', description: 'Anna - German female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-de_am_hans', name: 'DE_AM_HANS', language: 'de-de', gender: 'male', description: 'Hans - German male', engine: 'kokoro', quality: 'high' },
      
      // Italian voices
      { id: 'kokoro-it_af_giulia', name: 'IT_AF_GIULIA', language: 'it-it', gender: 'female', description: 'Giulia - Italian female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-it_am_marco', name: 'IT_AM_MARCO', language: 'it-it', gender: 'male', description: 'Marco - Italian male', engine: 'kokoro', quality: 'high' },
      
      // Portuguese voices
      { id: 'kokoro-pt_af_maria', name: 'PT_AF_MARIA', language: 'pt-br', gender: 'female', description: 'Maria - Portuguese female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-pt_am_joao', name: 'PT_AM_JOAO', language: 'pt-br', gender: 'male', description: 'João - Portuguese male', engine: 'kokoro', quality: 'high' },
      
      // Chinese voices
      { id: 'kokoro-zh_af_mei', name: 'ZH_AF_MEI', language: 'zh-cn', gender: 'female', description: 'Mei - Chinese female', engine: 'kokoro', quality: 'high' },
      { id: 'kokoro-zh_am_wei', name: 'ZH_AM_WEI', language: 'zh-cn', gender: 'male', description: 'Wei - Chinese male', engine: 'kokoro', quality: 'high' }
    ];
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
        'Text too long for Kokoro TTS (max 50,000 characters)',
        ErrorCodes.TEXT_TOO_LONG,
        this.name
      );
    }

    const startTime = Date.now();
    const voice = this.resolveVoice(request.voice);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const textPreview = request.text.slice(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
    const filename = `kokoro_${voice.name}_${timestamp}_${textPreview}.wav`;
    const outputPath = path.join(this.outputDir, filename);

    try {
      await this.ensureDirectoryExists(this.outputDir);
      
      // Create a Python script for Kokoro TTS synthesis
      const pythonScript = this.generateKokoroScript(request.text, voice, outputPath);
      const scriptPath = path.join(this.tempDir, `kokoro_${Date.now()}.py`);
      
      await fs.writeFile(scriptPath, pythonScript);
      await this.executeKokoro(scriptPath);
      
      // Clean up script
      await fs.unlink(scriptPath);

      const stats = await fs.stat(outputPath);
      const synthesisTime = Date.now() - startTime;

      return {
        filePath: outputPath,
        format: 'wav',
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
        'Kokoro synthesis failed',
        ErrorCodes.SYNTHESIS_FAILED,
        this.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private resolveVoice(requestedVoice?: string): Voice {
    if (!requestedVoice) {
      return this.voices.find(v => v.id === 'kokoro-af_sarah') || this.voices[0];
    }

    const voice = this.voices.find(v => 
      v.name.toLowerCase() === requestedVoice.toLowerCase() ||
      v.id.toLowerCase() === requestedVoice.toLowerCase() ||
      v.name.toLowerCase().includes(requestedVoice.toLowerCase())
    );

    if (!voice) {
      throw new TTSError(
        `Voice "${requestedVoice}" not found in Kokoro engine`,
        ErrorCodes.VOICE_NOT_FOUND,
        this.name
      );
    }

    return voice;
  }

  private generateKokoroScript(text: string, voice: Voice, outputPath: string): string {
    // Extract actual voice name from the voice object
    const voiceName = voice.name.replace(/^kokoro-/, '');
    
    return `#!/usr/bin/env python3
import os
import sys
import numpy as np
import soundfile as sf
from kokoro import KPipeline

def synthesize_with_kokoro(text, voice_name, output_path):
    """
    Real Kokoro TTS synthesis using the kokoro library KPipeline
    """
    try:
        # Map our voice names to Kokoro language codes and voice identifiers
        voice_config = {
            'AF_SARAH': {'lang': 'a', 'voice': 'af_sarah'},      # American English
            'AF_BELLA': {'lang': 'a', 'voice': 'af_bella'},     # American English
            'AF (American Female)': {'lang': 'a', 'voice': 'af'}, # American English
            'AM_ADAM': {'lang': 'a', 'voice': 'am_adam'},        # American English
            'AM_MICHAEL': {'lang': 'a', 'voice': 'am_michael'},  # American English
            'BF_EMMA': {'lang': 'b', 'voice': 'bf_emma'},        # British English
            'BM_GEORGE': {'lang': 'b', 'voice': 'bm_george'},    # British English
            'ES_AM_ANTONIO': {'lang': 'e', 'voice': 'es_am_antonio'}, # Spanish
            'ES_AF_MARIA': {'lang': 'e', 'voice': 'es_af_maria'},     # Spanish
            'FR_AM_PIERRE': {'lang': 'f', 'voice': 'fr_am_pierre'},   # French
            'FR_AF_SOPHIE': {'lang': 'f', 'voice': 'fr_af_sophie'},   # French
            'JA_AF_YUKI': {'lang': 'j', 'voice': 'ja_af_yuki'},       # Japanese
            'JA_AM_HIROSHI': {'lang': 'j', 'voice': 'ja_am_hiroshi'}, # Japanese
            'DE_AF_ANNA': {'lang': 'a', 'voice': 'de_af_anna'},       # German (use 'a' as fallback)
            'DE_AM_HANS': {'lang': 'a', 'voice': 'de_am_hans'},       # German (use 'a' as fallback)
            'IT_AF_GIULIA': {'lang': 'i', 'voice': 'it_af_giulia'},   # Italian
            'IT_AM_MARCO': {'lang': 'i', 'voice': 'it_am_marco'},     # Italian
            'PT_AF_MARIA': {'lang': 'p', 'voice': 'pt_af_maria'},     # Portuguese
            'PT_AM_JOAO': {'lang': 'p', 'voice': 'pt_am_joao'},       # Portuguese
            'ZH_AF_MEI': {'lang': 'z', 'voice': 'zh_af_mei'},         # Chinese
            'ZH_AM_WEI': {'lang': 'z', 'voice': 'zh_am_wei'}          # Chinese
        }
        
        # Get voice configuration or use default
        config = voice_config.get(voice_name, {'lang': 'a', 'voice': 'af_sarah'})
        lang_code = config['lang']
        voice_id = config['voice']
        
        print(f"Initializing Kokoro pipeline for language: {lang_code}")
        print(f"Using voice: {voice_id}")
        print(f"Text length: {len(text)} characters")
        
        # Initialize Kokoro pipeline for the specific language
        pipeline = KPipeline(lang_code, repo_id='hexgrad/Kokoro-82M')
        
        print("Pipeline initialized successfully")
        
        # Generate speech using the pipeline
        print("Starting speech generation...")
        
        # The pipeline call returns a generator
        audio_generator = pipeline(text, voice=voice_id)
        
        # Collect audio segments from the generator
        audio_segments = []
        print("Processing audio segments from generator...")
        
        # Iterate through the generator to get audio data
        for i, result in enumerate(audio_generator):
            print(f"Processing result {i}: type={type(result)}")
            
            # Extract audio tensor from KPipeline.Result object
            if hasattr(result, 'audio'):
                audio_tensor = result.audio
                print(f"Audio tensor shape: {audio_tensor.shape}")
                
                # Convert torch tensor to numpy
                if hasattr(audio_tensor, 'detach'):
                    chunk_array = audio_tensor.detach().cpu().numpy()
                elif hasattr(audio_tensor, 'numpy'):
                    chunk_array = audio_tensor.numpy()
                else:
                    chunk_array = np.array(audio_tensor)
                
                audio_segments.append(chunk_array)
                print(f"Converted to numpy array: {chunk_array.shape}")
            else:
                print(f"Warning: Result object has no audio attribute: {dir(result)}")
        
        if not audio_segments:
            raise Exception("No audio segments generated from pipeline")
        
        # Combine all audio segments
        audio_array = np.concatenate(audio_segments)
        
        print(f"Generated audio shape: {audio_array.shape}")
        print(f"Audio duration: {len(audio_array) / 24000:.2f} seconds")
        
        # Ensure audio is in the right format (1D array, float32)
        if len(audio_array.shape) > 1:
            audio_array = audio_array.flatten()
        
        # Normalize audio to prevent clipping
        if audio_array.max() > 1.0 or audio_array.min() < -1.0:
            audio_array = audio_array / np.max(np.abs(audio_array))
        
        # Save as WAV file using soundfile
        sf.write(output_path, audio_array, 24000)  # Kokoro outputs at 24kHz
        
        print(f"Kokoro TTS synthesis complete: {output_path}")
        print(f"Language: {lang_code}, Voice: {voice_id}, Text: {len(text)} chars")
        
    except Exception as e:
        print(f"Kokoro synthesis error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    text = """${text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"""
    voice_name = "${voiceName}"
    output_path = "${outputPath}"
    
    try:
        synthesize_with_kokoro(text, voice_name, output_path)
        print("SUCCESS")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
`;
  }

  private async executeKokoro(scriptPath: string): Promise<void> {
    if (!this.pythonExecutable) {
      throw new TTSError(
        'Python executable not detected - initialization may have failed',
        ErrorCodes.ENGINE_NOT_AVAILABLE,
        this.name
      );
    }

    console.error(`[Kokoro] Executing synthesis with: ${this.pythonExecutable}`);
    console.error(`[Kokoro] Script path: ${scriptPath}`);
    console.error(`[Kokoro] Environment PYTHONPATH: ${this.pythonEnvironment?.PYTHONPATH || 'Not set'}`);

    return new Promise((resolve, reject) => {
      const process = spawn(this.pythonExecutable!, [scriptPath], {
        env: this.pythonEnvironment,
        cwd: path.dirname(scriptPath)
      });
      
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.error(`[Kokoro Synthesis] ${output.trim()}`);
      });

      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error(`[Kokoro Synthesis Error] ${output.trim()}`);
      });

      process.on('close', (code) => {
        console.error(`[Kokoro] Process completed with code: ${code}`);
        
        if (code === 0 && stdout.includes('SUCCESS')) {
          console.error('[Kokoro] Synthesis completed successfully');
          resolve();
        } else {
          const errorMsg = `Kokoro synthesis failed (exit code ${code}):\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`;
          console.error(`[Kokoro] ${errorMsg}`);
          reject(new TTSError(
            errorMsg,
            ErrorCodes.SYNTHESIS_FAILED,
            this.name
          ));
        }
      });

      process.on('error', (error) => {
        const errorMsg = `Failed to spawn Python process: ${error.message}`;
        console.error(`[Kokoro] ${errorMsg}`);
        reject(new TTSError(
          errorMsg,
          ErrorCodes.ENGINE_NOT_AVAILABLE,
          this.name,
          error
        ));
      });

      setTimeout(() => {
        if (!process.killed) {
          console.error('[Kokoro] Synthesis timeout - killing process');
          process.kill('SIGTERM');
          reject(new TTSError(
            'Kokoro synthesis timeout (30 seconds)',
            ErrorCodes.TIMEOUT,
            this.name
          ));
        }
      }, 30000); // 30 second timeout
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