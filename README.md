# TextToSpeech-MCP Server

A local text-to-speech MCP server providing high-quality, privacy-first TTS synthesis using macOS Say and Kokoro TTS engines.

## Features

- **Local Processing**: All TTS synthesis happens locally - no data sent to external services
- **Multiple Engines**: 
  - macOS Say (fast, built-in, 23 voices, multiple languages)
  - Kokoro TTS (high-quality neural synthesis, 21 voices, 8 languages)
- **MCP Integration**: Works with Claude Desktop and other MCP-compatible clients
- **Multi-language Support**: 43 languages including English, Spanish, French, Japanese, Chinese, and more

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Project
```bash
npm run build
```

### 3. Test the Server
```bash
npm start
```

### 4. Configure Claude Desktop

Add this configuration to your Claude Desktop settings:

```json
{
  "mcpServers": {
    "local-tts": {
      "command": "node",
      "args": ["./dist/server.js"],
      "cwd": "/path/to/your/TextToSpeech-MCP"
    }
  }
}
```

## Available Tools

### `synthesize_text`
Convert text to speech with customizable options.

**Parameters:**
- `text` (required): Text to convert (max 50,000 characters)
- `voice` (optional): Voice name (e.g., "Alex", "Samantha", "Daniel")
- `engine` (optional): "macos", "kokoro", or "auto" (default: "auto")
- `outputFormat` (optional): "aiff", "wav", "mp3", "m4a" (default: "aiff")
- `speed` (optional): Speed multiplier 0.1-3.0 (default: 1.0)
- `quality` (optional): "fast", "balanced", "high" (default: "balanced")

### `list_voices`
List available voices with filtering options.

**Parameters:**
- `engine` (optional): "macos", "kokoro", "all" (default: "all")
- `language` (optional): Language filter (e.g., "en-us", "es", "fr")
- `gender` (optional): "male", "female", "neutral"

### `health_check`
Check engine availability and system health.

### `play_audio`
Play generated audio files with control options.

**Parameters:**
- `audioPath` (optional): Path to audio file (defaults to most recent)
- `action` (optional): "play", "pause", "stop", "resume" (default: "play")

## Example Usage

### Basic Synthesis
```
Use the synthesize_text tool to say "Hello, world!" using the default voice.
```

### Voice Selection
```
List all English female voices, then use one to synthesize a greeting.
```

### Multi-language
```
Synthesize "Bonjour le monde" using a French voice.
```

## Development

### Available Scripts
- `npm run build` - Build TypeScript
- `npm run dev` - Build with watch mode
- `npm start` - Start the server
- `npm test` - Run tests (coming soon)
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Environment Variables
- `TTS_OUTPUT_DIR` - Audio output directory (default: ./output)
- `TTS_TEMP_DIR` - Temporary files directory (default: ./temp)
- `TTS_ENGINE` - Default engine: "macos", "kokoro", "auto" (default: "auto")
- `TTS_QUALITY` - Default quality: "fast", "balanced", "high" (default: "balanced")

## Status

✅ **Phase 1 Complete**: macOS Say engine with 23 voices
✅ **Phase 2 Complete**: Kokoro TTS integration with 21 voices
📋 **Phase 3 Planned**: Batch audio playback and advanced features

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

Then open http://localhost:5173 to test the server interactively.

## Requirements

- macOS (for macOS Say engine)
- Node.js 18+
- TypeScript

## License

MIT