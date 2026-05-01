import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, Pause, Download, Wand2, Mic, ChevronRight, RefreshCw, 
  Volume2, Upload, FileVideo, Users, Settings2, HelpCircle, X, Activity, VolumeX, Layers, RotateCcw, Music, Sparkles, Image as ImageIcon, Camera
} from 'lucide-react';
import { AppStatus, DubSegment, LANGUAGES, VOICES, LanguageOption, SpeakerMap, DUBBING_STYLES } from '../types';
import { analyzeVideo, generateSpeech, fileToGenerativePart, editImage } from '../services/geminiService';

export const DubbingStudio: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [file, setFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [segments, setSegments] = useState<DubSegment[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  
  // Audio Settings
  const [backgroundVolume, setBackgroundVolume] = useState(0.80); // Default to 80% for better presence
  
  // Language & Voice Settings
  const [sourceLang, setSourceLang] = useState<LanguageOption>(LANGUAGES.find(l => l.code === 'en') || LANGUAGES[1]);
  const [targetLang, setTargetLang] = useState<LanguageOption>(LANGUAGES.find(l => l.code === 'ar') || LANGUAGES[0]);
  const [targetDialect, setTargetDialect] = useState<string>('Modern Standard Arabic (Fusha)');
  
  // Dubbing Style
  const [dubbingStyle, setDubbingStyle] = useState<string>(DUBBING_STYLES[0].id);
  
  // Default Voice Selection (Pre-Analysis)
  const [defaultVoice, setDefaultVoice] = useState<string>(VOICES[0].id);

  // Speaker Mapping
  const [speakerMap, setSpeakerMap] = useState<SpeakerMap>({});
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);

  // Thumbnail Studio State
  const [thumbnailPrompt, setThumbnailPrompt] = useState("");
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const [generatedThumbnail, setGeneratedThumbnail] = useState<string | null>(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [showThumbnailStudio, setShowThumbnailStudio] = useState(false);

  // Playback State
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const activeSpeechCountRef = useRef(0); // For Ducking Logic

  // Refs for Media Elements and Web Audio
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Web Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Nodes
  const monitorGainNodeRef = useRef<GainNode | null>(null); // Controls local speaker volume
  const masterDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null); // For recording
  const masterMixNodeRef = useRef<GainNode | null>(null);
  
  // Video Processing Nodes
  const videoSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const videoGainNodeRef = useRef<GainNode | null>(null);
  
  const activeSourceNodesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const lastSegmentEndTimeRef = useRef<number>(0); 

  // Initialize Web Audio API with "Scooped Mids" EQ (Better Vocal Removal for Mono/Stereo)
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;
      
      const monitorGain = ctx.createGain();
      const masterDest = ctx.createMediaStreamDestination();
      const masterMix = ctx.createGain(); // Final mix of (Background + TTS)
      
      // -- Video Processing Graph (Vocal Remover V2 - EQ Scoop) --
      if (videoRef.current) {
         if (!videoSourceNodeRef.current) {
             try {
                const videoSource = ctx.createMediaElementSource(videoRef.current);
                videoSourceNodeRef.current = videoSource;
             } catch (e) {
                console.warn("MediaElementSource attached", e);
             }
         }
         
         const bgGain = ctx.createGain();
         bgGain.gain.value = backgroundVolume;
         videoGainNodeRef.current = bgGain;

         if (videoSourceNodeRef.current) {
             // Instead of L-R Phase Cancellation (which kills Mono), we use a Cascade of Notch/Peaking Filters
             // to "scoop out" the vocal frequencies (300Hz - 3.4kHz) while keeping Bass and Highs.
             
             // 1. Bass Pass (Low Shelf) - Boosts rumble/drums below 200Hz
             const lowShelf = ctx.createBiquadFilter();
             lowShelf.type = 'lowshelf';
             lowShelf.frequency.value = 200;
             lowShelf.gain.value = 0; // Neutral pass, or slight boost

             // 2. Vocal Cut 1 (Fundamental)
             const notch1 = ctx.createBiquadFilter();
             notch1.type = 'peaking';
             notch1.frequency.value = 400; // Male voice fundamental center
             notch1.Q.value = 1.0; // Wide-ish
             notch1.gain.value = -24; // Aggressive cut

             // 3. Vocal Cut 2 (Core)
             const notch2 = ctx.createBiquadFilter();
             notch2.type = 'peaking';
             notch2.frequency.value = 1000; // Speech center
             notch2.Q.value = 1.0;
             notch2.gain.value = -24; 

             // 4. Vocal Cut 3 (Presence)
             const notch3 = ctx.createBiquadFilter();
             notch3.type = 'peaking';
             notch3.frequency.value = 2500; // Consonants/Presence
             notch3.Q.value = 1.0;
             notch3.gain.value = -24;

             // 5. Air Pass (High Shelf) - Restores brightness > 8kHz
             const highShelf = ctx.createBiquadFilter();
             highShelf.type = 'highshelf';
             highShelf.frequency.value = 8000;
             highShelf.gain.value = 2; // Slight boost to compensate for lost energy

             // Chain: Source -> LowShelf -> Notch1 -> Notch2 -> Notch3 -> HighShelf -> Gain
             videoSourceNodeRef.current.connect(lowShelf);
             lowShelf.connect(notch1);
             notch1.connect(notch2);
             notch2.connect(notch3);
             notch3.connect(highShelf);
             highShelf.connect(bgGain);
             
             // Output to Master
             bgGain.connect(masterMix);
         }
      }

      // Output
      masterMix.connect(masterDest);
      masterMix.connect(monitorGain);
      monitorGain.connect(ctx.destination);

      monitorGainNodeRef.current = monitorGain;
      masterDestNodeRef.current = masterDest;
      masterMixNodeRef.current = masterMix;
    } else if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }
  };
  
  // Dynamic Background Volume (Ducking)
  const updateDucking = () => {
      if (!videoGainNodeRef.current || !audioContextRef.current) return;
      
      const ctx = audioContextRef.current;
      const isSpeechActive = activeSpeechCountRef.current > 0;
      
      // If speech is active, duck background to 20% of its set volume
      // If idle, return to full set volume
      const targetVal = isSpeechActive ? (backgroundVolume * 0.20) : backgroundVolume;
      const effectiveGain = targetVal === 0 ? 0 : targetVal * targetVal; // Logarithmic

      // Smooth ramp to prevent clicking
      videoGainNodeRef.current.gain.setTargetAtTime(effectiveGain, ctx.currentTime, 0.2);
  };

  // Update base volume when slider changes
  useEffect(() => {
     updateDucking();
  }, [backgroundVolume]);

  const handleReset = () => {
    stopAllAudio();
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    setFile(null);
    setVideoSrc(null);
    setSegments([]);
    setStatus(AppStatus.IDLE);
    setDetectedSpeakers([]);
    setSpeakerMap({});
    setCurrentTime(0);
    setIsPlaying(false);
    setCapturedFrame(null);
    setGeneratedThumbnail(null);
    setThumbnailPrompt("");
    audioBuffersRef.current.clear();
    activeSourceNodesRef.current.clear();
    lastSegmentEndTimeRef.current = 0;
    activeSpeechCountRef.current = 0;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setVideoSrc(URL.createObjectURL(selectedFile));
      setStatus(AppStatus.IDLE);
      setSegments([]);
      setDetectedSpeakers([]);
      setSpeakerMap({});
    }
  };

  const trimAudioBuffer = (buffer: AudioBuffer, ctx: AudioContext): AudioBuffer => {
      const channelData = buffer.getChannelData(0);
      const threshold = 0.005; 
      let start = 0;
      let end = channelData.length;
      for (let i = 0; i < channelData.length; i++) {
          if (Math.abs(channelData[i]) > threshold) { start = i; break; }
      }
      for (let i = channelData.length - 1; i >= 0; i--) {
          if (Math.abs(channelData[i]) > threshold) { end = i + 1; break; }
      }
      if (end <= start) return buffer;
      const newLength = end - start;
      const newBuffer = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const oldData = buffer.getChannelData(ch);
          const newData = newBuffer.getChannelData(ch);
          for (let i = 0; i < newLength; i++) { newData[i] = oldData[start + i]; }
      }
      return newBuffer;
  };

  const startAnalysis = async () => {
    if (!file) return;
    initAudioContext();
    setStatus(AppStatus.ANALYZING);
    try {
      const base64 = await fileToGenerativePart(file);
      const results = await analyzeVideo(
        base64, file.type, sourceLang.name, targetLang.name, 
        targetLang.code === 'ar' || targetLang.dialects ? targetDialect : undefined,
        dubbingStyle
      );
      setSegments(results);
      const speakers = Array.from(new Set(results.map(s => s.speakerLabel)));
      setDetectedSpeakers(speakers);
      const newMap: SpeakerMap = {};
      speakers.forEach((spk) => {
        newMap[spk] = defaultVoice; // Force One Voice
      });
      setSpeakerMap(newMap);
      setStatus(AppStatus.READY_TO_DUB);
    } catch (err) {
      console.error(err);
      setStatus(AppStatus.ERROR);
    }
  };

  const handleSynthesizeSegment = async (id: string) => {
    const segment = segments.find(s => s.id === id);
    if (!segment) return;
    setSegments(prev => prev.map(s => s.id === id ? { ...s, isSynthesizing: true } : s));
    try {
      const voiceId = speakerMap[segment.speakerLabel] || defaultVoice;
      const audioUrl = await generateSpeech(segment.translatedText, voiceId);
      if (audioContextRef.current) {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        let audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        audioBuffer = trimAudioBuffer(audioBuffer, audioContextRef.current);
        audioBuffersRef.current.set(id, audioBuffer);
      }
      setSegments(prev => prev.map(s => s.id === id ? { ...s, audioUrl, isSynthesizing: false } : s));
    } catch (err) {
      console.error(err);
      setSegments(prev => prev.map(s => s.id === id ? { ...s, isSynthesizing: false } : s));
    }
  };
  
  const playPreviewSegment = async (id: string) => {
      const seg = segments.find(s => s.id === id);
      if (!seg) return;
      if (!audioContextRef.current) initAudioContext();
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();
      stopAllAudio();

      // Duck background
      activeSpeechCountRef.current = 1;
      updateDucking();

      if (videoRef.current) {
          videoRef.current.currentTime = seg.startTime;
          videoRef.current.muted = true; 
          videoRef.current.play();
          setTimeout(() => {
              if (videoRef.current) videoRef.current.pause();
              activeSpeechCountRef.current = 0; // Unduck
              updateDucking();
              stopAllAudio();
          }, (seg.endTime - seg.startTime + 1.5) * 1000);
      }

      const buffer = audioBuffersRef.current.get(id);
      if (buffer && monitorGainNodeRef.current) {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(monitorGainNodeRef.current);
          source.start();
          activeSourceNodesRef.current.set('preview-tts', source);
          source.onended = () => {
             activeSpeechCountRef.current = 0;
             updateDucking();
          };
      }
  };

  const stopAllAudio = () => {
      activeSourceNodesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
      activeSourceNodesRef.current.clear();
      activeSpeechCountRef.current = 0;
      updateDucking();
  };

  const scheduleSegment = (segment: DubSegment, anchorTime: number) => {
    const buffer = audioBuffersRef.current.get(segment.id);
    if (!audioContextRef.current || !buffer || !masterDestNodeRef.current || !monitorGainNodeRef.current) return;
    const ctx = audioContextRef.current;
    
    const idealStart = segment.startTime;
    const previousEnd = lastSegmentEndTimeRef.current;
    
    // Tight Gap
    const gap = 0.01; 
    let safePlayAt = Math.max(idealStart, previousEnd + gap); 
    
    const slotDuration = segment.endTime - segment.startTime;
    const audioDuration = buffer.duration;
    
    let playbackRate = 1.0;

    if (audioDuration > slotDuration) {
        const requiredSpeed = audioDuration / slotDuration;
        playbackRate = Math.min(1.15, requiredSpeed);
    } else if (audioDuration < slotDuration * 0.8) {
       playbackRate = 0.95;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    
    const effectiveDuration = audioDuration / playbackRate;
    const playAt = ctx.currentTime + Math.max(0, safePlayAt - anchorTime); 
    
    lastSegmentEndTimeRef.current = safePlayAt + effectiveDuration;

    source.connect(masterDestNodeRef.current);
    source.connect(monitorGainNodeRef.current);
    
    // Scheduling for Ducking
    // We can't use events reliably for precise future scheduling, so we schedule volume params on the timeline?
    // Complex. Simplified approach: Rely on visual feedback or post-processing?
    // Real-time approach: Use setTimeout to trigger the ducking state at the precise moment.
    const startDelayMS = (playAt - ctx.currentTime) * 1000;
    const endDelayMS = startDelayMS + (effectiveDuration * 1000);
    
    if (startDelayMS >= 0) {
        setTimeout(() => {
            activeSpeechCountRef.current++;
            updateDucking();
        }, startDelayMS);
        
        setTimeout(() => {
            activeSpeechCountRef.current = Math.max(0, activeSpeechCountRef.current - 1);
            updateDucking();
        }, endDelayMS);
    }

    source.start(playAt);
    
    activeSourceNodesRef.current.set(segment.id, source);
    source.onended = () => activeSourceNodesRef.current.delete(segment.id);
  };

  const playFullPreview = async () => {
    if (!videoRef.current || !audioContextRef.current) return;
    initAudioContext();
    if (isPlaying) {
      videoRef.current.pause();
      stopAllAudio();
      setIsPlaying(false);
    } else {
      await audioContextRef.current.resume();
      if (monitorGainNodeRef.current) monitorGainNodeRef.current.gain.value = 1.0;
      
      videoRef.current.currentTime = 0;
      videoRef.current.muted = true; 
      
      const sorted = [...segments].sort((a,b) => a.startTime - b.startTime);
      lastSegmentEndTimeRef.current = 0; 
      activeSpeechCountRef.current = 0;
      updateDucking();

      sorted.forEach(seg => scheduleSegment(seg, 0));
      
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleExport = async () => {
    if (!videoRef.current || !audioContextRef.current) return;
    if (segments.length === 0) return;

    // Auto-synthesize logic
    const missingAudioIds = segments.filter(s => !audioBuffersRef.current.has(s.id)).map(s => s.id);
    if (missingAudioIds.length > 0) {
      setStatus(AppStatus.SYNTHESIZING);
      initAudioContext();
      for (const id of missingAudioIds) {
        const seg = segments.find(s => s.id === id);
        if (seg) {
          setSegments(prev => prev.map(s => s.id === id ? { ...s, isSynthesizing: true } : s));
          try {
             const voiceId = speakerMap[seg.speakerLabel] || defaultVoice;
             const audioUrl = await generateSpeech(seg.translatedText, voiceId);
             if (audioContextRef.current) {
                const response = await fetch(audioUrl);
                const arrayBuffer = await response.arrayBuffer();
                let audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                audioBuffer = trimAudioBuffer(audioBuffer, audioContextRef.current); 
                audioBuffersRef.current.set(id, audioBuffer);
             }
             setSegments(prev => prev.map(s => s.id === id ? { ...s, audioUrl, isSynthesizing: false } : s));
          } catch(e) { console.error(e); }
        }
      }
    }

    setStatus(AppStatus.EXPORTING);
    setIsPlaying(false);
    stopAllAudio(); 
    initAudioContext();
    if (!audioContextRef.current || !masterDestNodeRef.current) return;
    await audioContextRef.current.resume();

    let videoStream: MediaStream;
    const vidEl = videoRef.current as any;
    if (vidEl.captureStream) videoStream = vidEl.captureStream(60);
    else if (vidEl.mozCaptureStream) videoStream = vidEl.mozCaptureStream(60);
    else { alert("Browser capture not supported."); setStatus(AppStatus.COMPLETED); return; }

    const mixedAudioStream = masterDestNodeRef.current.stream;
    const combinedStream = new MediaStream([ ...videoStream.getVideoTracks(), ...mixedAudioStream.getAudioTracks() ]);
    
    const options: any = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 25000000 };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'video/webm';
    
    const recorder = new MediaRecorder(combinedStream, options);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dubbed_${targetLang.code}_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStatus(AppStatus.COMPLETED);
      if (videoRef.current) { videoRef.current.currentTime = 0; videoRef.current.muted = false; }
      stopAllAudio();
      if (monitorGainNodeRef.current) monitorGainNodeRef.current.gain.value = 1;
    };

    if (monitorGainNodeRef.current) monitorGainNodeRef.current.gain.value = 0; 
    videoRef.current.currentTime = 0;
    videoRef.current.muted = true; 
    
    const sorted = [...segments].sort((a,b) => a.startTime - b.startTime);
    lastSegmentEndTimeRef.current = 0; 
    activeSpeechCountRef.current = 0;
    updateDucking();

    sorted.forEach(seg => scheduleSegment(seg, 0));
    const finalAudioEnd = lastSegmentEndTimeRef.current;

    recorder.start();
    try { await videoRef.current.play(); } catch (e) {}

    videoRef.current.onended = () => {
      const videoDuration = videoRef.current?.duration || 0;
      const extraTime = finalAudioEnd - videoDuration;
      if (extraTime > 0) {
          setTimeout(() => {
              if (recorder.state !== 'inactive') recorder.stop();
              if (videoRef.current) videoRef.current.onended = null;
          }, (extraTime * 1000) + 500);
      } else {
          if (recorder.state !== 'inactive') recorder.stop();
          if (videoRef.current) videoRef.current.onended = null;
      }
    };
  };

  const handleCaptureFrame = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      setCapturedFrame(dataUrl);
      setShowThumbnailStudio(true);
      setGeneratedThumbnail(null);
      setIsPlaying(false);
      videoRef.current.pause();
    }
  };

  const handleGenerateThumbnail = async () => {
    if (!capturedFrame || !thumbnailPrompt) return;
    setIsGeneratingThumbnail(true);
    try {
      const base64Data = capturedFrame.split(',')[1];
      const result = await editImage(base64Data, thumbnailPrompt);
      setGeneratedThumbnail(result);
    } catch (e) {
      console.error(e);
      alert("Failed to generate image. Please try again.");
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  const handleTimeUpdate = () => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); };

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden font-sans">
      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl p-6 relative">
            <button onClick={() => setShowHelp(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
            <h2 className="text-2xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">Audio Engine 4.1 Pro</h2>
            <p className="text-slate-300 mb-4">Features:</p>
            <ul className="space-y-2 text-slate-300 list-disc pl-5">
              <li><strong>Scooped Mids EQ:</strong> Intelligent vocal removal that preserves Bass (Drums) and Treble (Air) even on mono videos.</li>
              <li><strong>Auto-Ducking:</strong> Background music automatically lowers volume when the AI voice speaks.</li>
              <li><strong>Consistency Lock:</strong> Single Persona dialect enforcement.</li>
              <li><strong>Smart Timing:</strong> Translations are summarized to fit original timing naturally.</li>
            </ul>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setShowHelp(false)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">Got it</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Thumbnail Studio Modal */}
      {showThumbnailStudio && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-5xl w-full shadow-2xl p-6 flex flex-col h-[85vh]">
               <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                     <div className="p-2 bg-purple-600/20 rounded-lg"><ImageIcon className="w-6 h-6 text-purple-400" /></div>
                     <div>
                        <h2 className="text-xl font-bold text-white">AI Thumbnail Studio</h2>
                        <p className="text-xs text-slate-400">Powered by Gemini 2.5 Flash Image (Nano Banana)</p>
                     </div>
                  </div>
                  <button onClick={() => setShowThumbnailStudio(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
               </div>
               
               <div className="flex-1 flex gap-6 min-h-0">
                  <div className="flex-1 flex flex-col gap-2">
                     <span className="text-xs font-semibold text-slate-400 uppercase">Original Frame</span>
                     <div className="flex-1 bg-black rounded-xl overflow-hidden border border-slate-800 relative">
                        {capturedFrame && <img src={capturedFrame} className="w-full h-full object-contain" alt="Original" />}
                     </div>
                  </div>
                  <div className="flex items-center justify-center">
                     <ChevronRight className="w-8 h-8 text-slate-700" />
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                     <span className="text-xs font-semibold text-purple-400 uppercase">Generated Result</span>
                     <div className="flex-1 bg-black rounded-xl overflow-hidden border border-purple-900/30 relative">
                        {isGeneratingThumbnail ? (
                           <div className="absolute inset-0 flex flex-col items-center justify-center text-purple-400">
                              <RefreshCw className="w-10 h-10 animate-spin mb-4" />
                              <span className="animate-pulse">Processing...</span>
                           </div>
                        ) : generatedThumbnail ? (
                           <img src={generatedThumbnail} className="w-full h-full object-contain" alt="Generated" />
                        ) : (
                           <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                              Waiting for prompt...
                           </div>
                        )}
                     </div>
                  </div>
               </div>
               
               <div className="mt-6 pt-6 border-t border-slate-800 flex gap-4">
                  <input 
                    type="text" 
                    value={thumbnailPrompt} 
                    onChange={(e) => setThumbnailPrompt(e.target.value)}
                    placeholder="Describe edits: 'Add a retro glitch filter', 'Remove background', 'Make it cinematic'..." 
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                  <button 
                    onClick={handleGenerateThumbnail}
                    disabled={isGeneratingThumbnail || !thumbnailPrompt}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-white flex items-center gap-2 shadow-lg shadow-purple-600/20"
                  >
                     <Wand2 className="w-5 h-5" /> Generate
                  </button>
                  {generatedThumbnail && (
                     <a 
                       href={generatedThumbnail} 
                       download="thumbnail.png"
                       className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-semibold text-white flex items-center gap-2"
                     >
                        <Download className="w-5 h-5" /> Download
                     </a>
                  )}
               </div>
            </div>
         </div>
      )}

      {/* Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Mic className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
            LinguaDub AI Pro
          </span>
        </div>
        <div className="flex items-center space-x-4">
           <button onClick={handleReset} className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm border border-slate-700">
             <RotateCcw className="w-4 h-4" /> <span>New Project</span>
           </button>
           <button onClick={() => setShowHelp(true)} className="flex items-center space-x-1 text-slate-400 hover:text-white"><HelpCircle className="w-5 h-5" /></button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900 overflow-y-auto custom-scrollbar">
          <div className="p-4 space-y-6">
            <div className="aspect-video bg-slate-950 rounded-xl overflow-hidden relative group border border-slate-800">
              {videoSrc ? (
                <>
                  <video 
                    ref={videoRef} src={videoSrc} className="w-full h-full object-contain" 
                    onTimeUpdate={handleTimeUpdate} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                    crossOrigin="anonymous" controls={false} 
                  />
                  {/* Thumbnail Capture Button Overlay */}
                  <button 
                     onClick={handleCaptureFrame}
                     className="absolute bottom-2 right-2 p-2 bg-black/60 hover:bg-purple-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                     title="Create AI Thumbnail"
                  >
                     <Camera className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-900">
                  <Upload className="w-8 h-8 text-indigo-500 mb-2" />
                  <span className="text-xs text-slate-400 font-medium">Upload Video</span>
                  <input type="file" accept="video/mp4,video/webm" onChange={handleFileUpload} className="hidden" />
                </label>
              )}
            </div>

            <div className="bg-slate-800/50 p-4 rounded-xl space-y-4 border border-slate-700/50">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <div className="flex items-center gap-2"><Music className="w-3 h-3" /> Music & Ambience</div>
                </div>
                <div>
                   <label className="flex items-center justify-between text-xs text-slate-400 mb-2">
                       <span>Master Level</span>
                       <span>{Math.round(backgroundVolume * 100)}%</span>
                   </label>
                   <input 
                     type="range" min="0" max="1" step="0.01" 
                     value={backgroundVolume} 
                     onChange={(e) => setBackgroundVolume(parseFloat(e.target.value))}
                     className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500"
                   />
                   <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                      *EQ "Scoop" Active: Vocals removed via freq cut. Background auto-ducks during speech.
                   </p>
                </div>
            </div>

            <div className="space-y-3">
               <div>
                  <label className="block text-xs text-slate-500 mb-1">Source Language</label>
                  <select value={sourceLang.code} onChange={(e) => setSourceLang(LANGUAGES.find(l => l.code === e.target.value) || LANGUAGES[1])} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none">
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                  </select>
               </div>
               <div>
                  <label className="block text-xs text-slate-500 mb-1">Target Language</label>
                  <select value={targetLang.code} onChange={(e) => {
                     const l = LANGUAGES.find(x => x.code === e.target.value) || LANGUAGES[0];
                     setTargetLang(l);
                     if(l.dialects) setTargetDialect(l.dialects[0]);
                     else setTargetDialect('');
                  }} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none">
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                  </select>
               </div>
               
               {targetLang.dialects && (
                   <div>
                      <label className="block text-xs text-emerald-400 mb-1">Target Dialect</label>
                      <select 
                        value={targetDialect} 
                        onChange={(e) => setTargetDialect(e.target.value)} 
                        className="w-full bg-slate-800 border border-emerald-500/30 text-emerald-100 rounded-lg px-3 py-2 text-sm focus:outline-none"
                      >
                        {targetLang.dialects.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                   </div>
               )}
               
               {/* Dubbing Style Selector */}
               <div>
                  <label className="block text-xs text-indigo-400 mb-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Dubbing Style (Tone)
                  </label>
                  <select 
                    value={dubbingStyle} 
                    onChange={(e) => setDubbingStyle(e.target.value)} 
                    disabled={status !== AppStatus.IDLE}
                    className="w-full bg-slate-800 border border-indigo-500/30 text-indigo-100 rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
                  >
                    {DUBBING_STYLES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
               </div>

               {/* Pre-Analysis Voice Selector */}
               <div>
                  <label className="block text-xs text-indigo-400 mb-1">Unified Voice (Narrator)</label>
                  <select 
                    value={defaultVoice} 
                    onChange={(e) => setDefaultVoice(e.target.value)} 
                    disabled={status !== AppStatus.IDLE && status !== AppStatus.READY_TO_DUB}
                    className="w-full bg-slate-800 border border-indigo-500/30 text-indigo-100 rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
                  >
                    {VOICES.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender})</option>)}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">This voice will be used for ALL detected speakers.</p>
               </div>
            </div>

            <div className="pt-2">
                <button 
                  onClick={startAnalysis}
                  disabled={!file || status === AppStatus.ANALYZING}
                  className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center space-x-2 transition-all shadow-lg ${
                    !file ? 'bg-slate-800 text-slate-600 cursor-not-allowed' :
                    status === AppStatus.ANALYZING ? 'bg-blue-600/50 text-white/50 cursor-wait' :
                    'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40'
                  }`}
                >
                  {status === AppStatus.ANALYZING ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                  <span>{status === AppStatus.ANALYZING ? 'Processing...' : 'Analyze & Dub Video'}</span>
                </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Timeline */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
           <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur">
              <div className="flex items-center space-x-4">
                 <button 
                    onClick={playFullPreview}
                    disabled={!videoSrc}
                    className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current pl-0.5" />}
                 </button>
                 <div className="text-sm font-medium text-slate-400 tabular-nums">
                    {new Date(currentTime * 1000).toISOString().substr(14, 5)}
                 </div>
              </div>
              
              <button
                onClick={handleExport}
                disabled={segments.length === 0 || status === AppStatus.EXPORTING}
                className={`px-5 py-2 rounded-lg font-medium flex items-center space-x-2 transition-all ${
                   segments.length === 0 ? 'bg-slate-800 text-slate-600 cursor-not-allowed' :
                   status === AppStatus.EXPORTING ? 'bg-emerald-600/50 text-white/50 cursor-wait' :
                   'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                }`}
              >
                 {status === AppStatus.EXPORTING ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                 <span>Export Video</span>
              </button>
           </div>

           <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
              {segments.map((seg) => {
                 const isActive = currentTime >= seg.startTime && currentTime <= seg.endTime;
                 return (
                    <div key={seg.id} className={`relative bg-slate-900 border rounded-xl p-4 transition-all duration-300 ${isActive ? 'border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/20' : 'border-slate-800 hover:border-slate-700'}`}>
                       <div className="flex items-start space-x-4">
                          <div className="w-24 pt-1 flex flex-col space-y-2">
                             <div className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded w-fit">{seg.startTime.toFixed(1)}s</div>
                             <div className="flex items-center space-x-1.5 px-2 py-1 bg-indigo-500/10 rounded-md w-fit">
                                <Users className="w-3 h-3 text-indigo-400" />
                                <span className="text-[10px] font-bold text-indigo-300 uppercase">{seg.speakerLabel}</span>
                             </div>
                             {seg.audioUrl && (
                                <button onClick={() => playPreviewSegment(seg.id)} className="flex items-center space-x-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md w-fit text-xs text-emerald-400 transition-colors">
                                   <Play className="w-3 h-3 fill-current" /> <span>Preview</span>
                                </button>
                             )}
                          </div>
                          <div className="flex-1 space-y-3">
                             <div className="relative">
                                <div className="absolute left-3 top-3 text-slate-500"><Mic className="w-3 h-3" /></div>
                                <div className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-9 py-2.5 text-sm text-slate-400">{seg.originalText}</div>
                             </div>
                             <div className="relative group">
                                <div className="absolute left-3 top-3 text-indigo-500"><Volume2 className="w-3 h-3" /></div>
                                <textarea 
                                  value={seg.translatedText}
                                  onChange={(e) => setSegments(prev => prev.map(s => s.id === seg.id ? {...s, translatedText: e.target.value, audioUrl: undefined} : s))}
                                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg pl-9 pr-12 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 min-h-[50px] resize-none font-arabic"
                                  dir="rtl"
                                />
                                <button onClick={() => handleSynthesizeSegment(seg.id)} disabled={seg.isSynthesizing} className="absolute right-2 top-2 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
                                   {seg.isSynthesizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                </button>
                             </div>
                          </div>
                       </div>
                    </div>
                 );
              })}
           </div>
        </div>
      </main>
    </div>
  );
};
