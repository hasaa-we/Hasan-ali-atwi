import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { DubSegment } from "../types";

// Helper to convert file to Base64
export const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g. "data:video/mp4;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

export const analyzeVideo = async (
  fileBase64: string,
  mimeType: string,
  sourceLang: string,
  targetLang: string,
  targetDialect?: string,
  dubbingStyle: string = 'Natural'
): Promise<DubSegment[]> => {
  const ai = getClient();
  
  // Define response schema for structured output
  const segmentSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            startTime: { type: Type.NUMBER, description: "Start time in seconds (float). Extremely precise start of speech." },
            endTime: { type: Type.NUMBER, description: "End time in seconds (float). Extremely precise end of speech." },
            originalText: { type: Type.STRING, description: "The transcribed original text" },
            translatedText: { type: Type.STRING, description: "The translated text. MUST be summarized to fit the time duration." },
            speakerLabel: { type: Type.STRING, description: "Identify the speaker (e.g., 'Speaker 1', 'Speaker 2')." }
          },
          required: ["startTime", "endTime", "originalText", "translatedText", "speakerLabel"]
        }
      }
    }
  };

  const dialectInstruction = targetDialect 
    ? `Translate explicitly into **PURE ${targetDialect}**. 
       CRITICAL DIALECT RULE: You are a single character/persona native to this region.
       - Use ONLY vocabulary specific to this dialect. 
       - Do NOT mix dialects (e.g. NEVER mix Lebanese with Egyptian). 
       - If the target is Lebanese, use "Kifak" not "Ezzayak". 
       - If the target is Egyptian, use "Ezzayak" not "Kifak".
       - Maintain this EXACT persona for ALL speakers in the video.`
    : `Translate into standard ${targetLang}.`;

  const prompt = `
    You are a professional Dubbing Director and Translator.
    
    TASK:
    1. **Diarization**: Identify speakers (Speaker 1, Speaker 2).
    2. **Transcription**: Transcribe the ${sourceLang} audio.
    3. **Time-Constrained Translation (CRITICAL)**: 
       - Translate the speech into ${targetDialect || targetLang}.
       - **SYNC RULE**: The translated text MUST fit the exact duration of the original speech.
       - **SUMMARIZATION**: If the literal translation is too long, YOU MUST SUMMARIZE OR REPHRASE.
       - Example: If original is "Hello, how are you doing today?" (1.5s) -> Arabic literal is too long. Use "Ahlan" or "Kefak" (short) to fit the 1.5s gap.
       - **DO NOT** produce long sentences for short time slots. The Dubbing will fail if you do.
    
    4. **Dialect & Tone Consistency**:
       - ${dialectInstruction}
       - Maintain a single, consistent "Straight Voice" style.
       - Do not shift tones (e.g. from formal to slang) mid-conversation unless the original video does.
       - If translating to Arabic, provide **FULL TASHKEEL (Diacritics)** on every letter.

    5. **Style**: ${dubbingStyle}.
       - Add natural punctuation (.,?) to control TTS breathing.

    6. **Timestamps**:
       - Precise start/end times.
       - Merge very short fragmented sentences (< 0.5s) into the next segment to create better flow.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType, data: fileBase64 } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: segmentSchema,
        systemInstruction: "You are an expert Dubbing Engine. Your priority is SYNCHRONIZATION and CONSISTENCY. You prefer short, punchy, natural translations over long literal ones.",
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response from AI");

    const parsed = JSON.parse(jsonText);
    
    return parsed.segments.map((seg: any, index: number) => ({
      ...seg,
      id: `seg-${index}-${Date.now()}`
    }));

  } catch (error) {
    console.error("Analysis Error:", error);
    throw error;
  }
};

export const generateSpeech = async (
  text: string,
  voiceName: string
): Promise<string> => {
  const ai = getClient();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No audio data generated");
    }

    // Convert base64 to Blob URL for playback
    const binaryString = window.atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const wavBlob = pcmToWav(bytes, 24000); 
    return URL.createObjectURL(wavBlob);

  } catch (error) {
    console.error("TTS Error:", error);
    throw error;
  }
};

export const editImage = async (
  base64Image: string,
  promptText: string
): Promise<string> => {
  const ai = getClient();
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png', // Assuming canvas export is PNG
              data: base64Image
            }
          },
          {
            text: promptText
          }
        ]
      },
    });

    // Check parts for the image
    let base64Result = '';
    const parts = response.candidates?.[0]?.content?.parts;
    
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          base64Result = part.inlineData.data;
          break; // Found the image
        }
      }
    }

    if (!base64Result) {
      throw new Error("No image generated");
    }

    return `data:image/png;base64,${base64Result}`;

  } catch (error) {
    console.error("Image Edit Error:", error);
    throw error;
  }
};

// Helper to add WAV header to raw PCM
function pcmToWav(pcmData: Uint8Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16; 
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length; 

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true); 
  view.setUint16(22, numChannels, true); 
  view.setUint32(24, sampleRate, true); 
  view.setUint32(28, byteRate, true); 
  view.setUint16(32, blockAlign, true); 
  view.setUint16(34, bitsPerSample, true); 

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM data
  const pcmBytes = new Uint8Array(buffer, 44);
  pcmBytes.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}