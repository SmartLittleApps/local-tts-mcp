import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'child_process';
import { TTSError, ErrorCodes } from '../types/index.js';

export const playAudioSchema = z.object({
  audioPath: z.string().describe('Path to audio file to play (defaults to most recent if not provided)').optional(),
  action: z.enum(['play', 'pause', 'stop', 'resume']).describe('Audio playback action').default('play')
});

export type PlayAudioRequest = z.infer<typeof playAudioSchema>;

class AudioPlayer {
  private static instance: AudioPlayer;
  private currentProcess: ChildProcess | null = null;
  private isPaused = false;
  private currentFile: string | null = null;
  private mostRecentFile: string | null = null;

  static getInstance(): AudioPlayer {
    if (!AudioPlayer.instance) {
      AudioPlayer.instance = new AudioPlayer();
    }
    return AudioPlayer.instance;
  }

  setMostRecentFile(filePath: string): void {
    this.mostRecentFile = filePath;
  }

  async playAudio(request: PlayAudioRequest): Promise<{ message: string; status: string; file?: string }> {
    const { audioPath, action } = request;
    
    switch (action) {
      case 'play':
        return this.play(audioPath);
      case 'pause':
        return this.pause();
      case 'stop':
        return this.stop();
      case 'resume':
        return this.resume();
      default:
        throw new TTSError(`Invalid action: ${action}`, ErrorCodes.INVALID_PARAMETERS);
    }
  }

  private async play(audioPath?: string): Promise<{ message: string; status: string; file?: string }> {
    const filePath = audioPath || this.mostRecentFile;
    
    if (!filePath) {
      throw new TTSError('No audio file specified and no recent file available', ErrorCodes.FILE_NOT_FOUND);
    }

    // Stop current playback if any
    await this.stop();

    try {
      // Use macOS afplay for audio playback (cross-platform alternatives: sox, ffplay, vlc)
      this.currentProcess = spawn('afplay', [filePath]);
      this.currentFile = filePath;
      this.isPaused = false;

      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        this.currentFile = null;
        this.isPaused = false;
      });

      this.currentProcess.on('error', (error) => {
        throw new TTSError(`Audio playback failed: ${error.message}`, ErrorCodes.PLAYBACK_FAILED);
      });

      return {
        message: `Started playing audio file`,
        status: 'playing',
        file: filePath
      };
    } catch (error) {
      throw new TTSError(`Failed to start audio playback: ${error}`, ErrorCodes.PLAYBACK_FAILED);
    }
  }

  private async pause(): Promise<{ message: string; status: string }> {
    if (!this.currentProcess || this.isPaused) {
      return {
        message: 'No active playback to pause',
        status: 'stopped'
      };
    }

    // Send SIGSTOP to pause the process
    this.currentProcess.kill('SIGSTOP');
    this.isPaused = true;

    return {
      message: 'Audio playback paused',
      status: 'paused'
    };
  }

  private async resume(): Promise<{ message: string; status: string }> {
    if (!this.currentProcess || !this.isPaused) {
      return {
        message: 'No paused playback to resume',
        status: this.currentProcess ? 'playing' : 'stopped'
      };
    }

    // Send SIGCONT to resume the process
    this.currentProcess.kill('SIGCONT');
    this.isPaused = false;

    return {
      message: 'Audio playback resumed',
      status: 'playing'
    };
  }

  private async stop(): Promise<{ message: string; status: string }> {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
      this.currentFile = null;
      this.isPaused = false;

      return {
        message: 'Audio playback stopped',
        status: 'stopped'
      };
    }

    return {
      message: 'No active playback to stop',
      status: 'stopped'
    };
  }

  getStatus(): { status: string; file?: string; isPaused: boolean } {
    return {
      status: this.currentProcess ? (this.isPaused ? 'paused' : 'playing') : 'stopped',
      file: this.currentFile || undefined,
      isPaused: this.isPaused
    };
  }
}

export async function playAudioHandler(request: unknown): Promise<CallToolResult> {
  try {
    const validatedRequest = playAudioSchema.parse(request);
    const player = AudioPlayer.getInstance();
    const result = await player.playAudio(validatedRequest);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    if (error instanceof TTSError) {
      throw error;
    }
    throw new TTSError(
      `Audio playback failed: ${error}`,
      ErrorCodes.PLAYBACK_FAILED
    );
  }
}

// Export the AudioPlayer instance for use in other tools
export const audioPlayer = AudioPlayer.getInstance();