import WebSocket, { RawData } from 'ws';
import {
  constants,
  createCipheriv,
  createPublicKey,
  KeyObject,
  publicEncrypt,
  randomBytes,
} from 'crypto';
import { LoxonePlatform } from '../../LoxonePlatform';

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown[];
  result?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface RtcSessionDescriptionInitLike {
  type: string;
  sdp?: string;
}

interface RtcIceCandidateInitLike {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

interface RtcIceCandidateLike {
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

interface RtcMediaStreamTrackLike {
  stop?: () => void;
}

interface RtcAudioSourceLike {
  createTrack: () => RtcMediaStreamTrackLike;
  onData: (data: {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
    numberOfFrames: number;
  }) => void;
}

interface RtcPeerConnectionLike {
  localDescription?: RtcSessionDescriptionInitLike | null;
  connectionState?: string;
  onicecandidate?: ((event: { candidate: RtcIceCandidateLike | null }) => void) | null;
  onconnectionstatechange?: (() => void) | null;
  addTrack: (track: RtcMediaStreamTrackLike) => unknown;
  createOffer: (options?: Record<string, unknown>) => Promise<RtcSessionDescriptionInitLike>;
  setLocalDescription: (desc: RtcSessionDescriptionInitLike) => Promise<void>;
  setRemoteDescription: (desc: RtcSessionDescriptionInitLike) => Promise<void>;
  addIceCandidate: (candidate: RtcIceCandidateLike) => Promise<void>;
  close: () => void;
}

interface WrtcModuleLike {
  RTCPeerConnection: new (config: Record<string, unknown>) => RtcPeerConnectionLike;
  RTCIceCandidate: new (init: RtcIceCandidateInitLike) => RtcIceCandidateLike;
  RTCSessionDescription: new (init: RtcSessionDescriptionInitLike) => RtcSessionDescriptionInitLike;
  nonstandard?: {
    RTCAudioSource: new () => RtcAudioSourceLike;
  };
}

export interface LoxoneTalkbackOptions {
  platform: LoxonePlatform;
  cameraName: string;
  signalingBaseUrl: string;
  username: string;
  getToken: () => string | undefined;
}

export class LoxoneTalkbackSession {
  private readonly rpcTimeoutMs = 10000;
  private readonly authMethod = 'authenticate';
  private readonly wsProtocol = 'webrtc-signaling';
  private readonly pcmSampleRate = 48000;
  private readonly pcmChannelCount = 1;
  private readonly pcmBitsPerSample = 16;
  private readonly pcmFramesPerChunk = 480; // 10ms @ 48kHz

  private socket?: WebSocket;
  private wrtc?: WrtcModuleLike;
  private peerConnection?: RtcPeerConnectionLike;
  private audioSource?: RtcAudioSourceLike;
  private localTrack?: RtcMediaStreamTrackLike;

  private rpcId = 0;
  private pendingRpc = new Map<number, PendingRpc>();
  private localIceQueue: RtcIceCandidateLike[] = [];
  private remoteIceQueue: RtcIceCandidateLike[] = [];
  private peerReady = false;
  private stopped = false;
  private started = false;
  private pcmBuffer = Buffer.alloc(0);

  private authChallengeTimer?: NodeJS.Timeout;
  private readyPromise?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;

  constructor(
    private readonly options: LoxoneTalkbackOptions,
  ) {}

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    try {
      await this.connectAndAuthorize();
      const info = await this.getDeviceInfo();
      await this.initializePeerConnection(info);
      this.options.platform.log.info(
        `[${this.options.cameraName}] Loxone WebRTC talkback signaling established.`,
      );
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  public pushPcmChunk(chunk: Buffer): void {
    if (this.stopped || !this.audioSource || chunk.length === 0) {
      return;
    }

    this.pcmBuffer = this.pcmBuffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.pcmBuffer, chunk]);

    const frameBytes = this.pcmFramesPerChunk * this.pcmChannelCount * (this.pcmBitsPerSample / 8);
    while (this.pcmBuffer.length >= frameBytes) {
      const frame = this.pcmBuffer.subarray(0, frameBytes);
      this.pcmBuffer = this.pcmBuffer.subarray(frameBytes);

      const samples = new Int16Array(this.pcmFramesPerChunk);
      Buffer.from(samples.buffer).set(frame);

      try {
        this.audioSource.onData({
          samples,
          sampleRate: this.pcmSampleRate,
          bitsPerSample: this.pcmBitsPerSample,
          channelCount: this.pcmChannelCount,
          numberOfFrames: this.pcmFramesPerChunk,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.platform.log.debug(
          `[${this.options.cameraName}] Failed to feed PCM frame to WebRTC source: ${message}`,
        );
      }
    }
  }

  public stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    this.clearAuthTimers();

    try {
      this.sendJson({
        jsonrpc: '2.0',
        method: 'hangup',
        id: this.rpcId++,
      });
    } catch {
      // Ignore best-effort hangup failures during shutdown.
    }

    this.rejectAllPendingRpc(new Error('Talkback stopped'));
    this.rejectReadyPromise(new Error('Talkback stopped'));

    try {
      this.localTrack?.stop?.();
    } catch {
      // Ignore.
    }

    try {
      this.peerConnection?.close();
    } catch {
      // Ignore.
    }

    this.peerConnection = undefined;
    this.audioSource = undefined;
    this.localTrack = undefined;
    this.peerReady = false;
    this.localIceQueue = [];
    this.remoteIceQueue = [];
    this.pcmBuffer = Buffer.alloc(0);

    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.close();
      } catch {
        // Ignore.
      }
    }
    this.socket = undefined;
  }

  private async connectAndAuthorize(): Promise<void> {
    const wsUrl = this.toWsUrl(this.options.signalingBaseUrl);

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.socket = new WebSocket(wsUrl, this.wsProtocol);
    this.socket.on('open', () => {
      this.authChallengeTimer = setTimeout(() => {
        this.rejectReadyPromise(new Error('No auth challenge received from Loxone intercom'));
      }, this.rpcTimeoutMs);
    });

    this.socket.on('message', (data: RawData) => {
      void this.handleSocketMessage(data);
    });

    this.socket.on('error', (error: Error) => {
      this.rejectReadyPromise(error);
    });

    this.socket.on('close', (code: number, reason: Buffer) => {
      const reasonText = reason.toString('utf8') || `code ${code}`;
      const error = new Error(`Signaling socket closed: ${reasonText}`);
      this.rejectReadyPromise(error);
      if (!this.stopped) {
        this.options.platform.log.debug(
          `[${this.options.cameraName}] Loxone signaling socket closed: ${reasonText}`,
        );
      }
    });

    await this.readyPromise;
  }

  private async getDeviceInfo(): Promise<Record<string, unknown>> {
    const info = await this.callRpc('info');
    if (!info || typeof info !== 'object') {
      return {};
    }
    return info as Record<string, unknown>;
  }

  private async initializePeerConnection(info: Record<string, unknown>): Promise<void> {
    const callState = this.numberValue(info.callState);
    if (callState !== undefined && callState !== 0) {
      throw new Error(`Loxone intercom is occupied (callState=${callState})`);
    }

    this.wrtc = this.loadWrtcModule();
    const audioSourceCtor = this.wrtc.nonstandard?.RTCAudioSource;
    if (!audioSourceCtor) {
      throw new Error('wrtc nonstandard.RTCAudioSource is not available');
    }

    this.audioSource = new audioSourceCtor();
    this.localTrack = this.audioSource.createTrack();

    const rtcConfig: Record<string, unknown> = {
      iceServers: [
        { urls: ['stun:stun.loxonecloud.com:3478'] },
        { urls: ['stun:stun.l.google.com:19302'] },
      ],
      iceTransportPolicy: 'all',
    };

    const turnUser = this.stringValue(info.turnuser);
    const turnPass = this.stringValue(info.turnpass);
    if (turnUser && turnPass) {
      const iceServers = rtcConfig.iceServers as Array<Record<string, unknown>>;
      iceServers.push({
        urls: ['turn:stun.loxonecloud.com:3478'],
        username: turnUser,
        credential: turnPass,
      });
    }

    this.peerConnection = new this.wrtc.RTCPeerConnection(rtcConfig);
    this.peerConnection.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (candidate) {
        if (this.peerReady) {
          void this.sendLocalIceCandidate(candidate);
        } else {
          this.localIceQueue.push(candidate);
        }
      } else {
        void this.sendNotification('iceGatheringFinished', null);
      }
    };
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.options.platform.log.debug(
          `[${this.options.cameraName}] Loxone WebRTC connection state: ${state}`,
        );
      }
    };
    this.peerConnection.addTrack(this.localTrack);

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await this.peerConnection.setLocalDescription(offer);

    const offerPayload = {
      type: offer.type,
      sdp: offer.sdp ?? '',
    };

    const answerRaw = await this.callRpc('call', [
      offerPayload,
      'add_audio',
      false,
      0,
    ]);
    const answer = this.normalizeSessionDescription(answerRaw);
    await this.peerConnection.setRemoteDescription(new this.wrtc.RTCSessionDescription(answer));

    this.peerReady = true;
    await this.flushQueuedIceCandidates();
  }

  private async flushQueuedIceCandidates(): Promise<void> {
    while (this.localIceQueue.length > 0) {
      const candidate = this.localIceQueue.shift();
      if (!candidate) {
        continue;
      }
      await this.sendLocalIceCandidate(candidate);
    }

    while (this.remoteIceQueue.length > 0) {
      const candidate = this.remoteIceQueue.shift();
      if (!candidate) {
        continue;
      }
      try {
        await this.peerConnection?.addIceCandidate(candidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.platform.log.debug(
          `[${this.options.cameraName}] Failed to flush remote ICE candidate: ${message}`,
        );
      }
    }
  }

  private async sendLocalIceCandidate(candidate: RtcIceCandidateLike): Promise<void> {
    if (!candidate.candidate) {
      return;
    }

    try {
      await this.callRpc('addIceCandidate', [
        candidate.candidate,
        candidate.sdpMLineIndex ?? 0,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.platform.log.debug(
        `[${this.options.cameraName}] Failed to send local ICE candidate: ${message}`,
      );
    }
  }

  private async handleSocketMessage(data: RawData): Promise<void> {
    const payload = this.rawDataToString(data);
    let rpc: JsonRpcMessage;

    try {
      rpc = JSON.parse(payload) as JsonRpcMessage;
    } catch (error) {
      this.options.platform.log.debug(
        `[${this.options.cameraName}] Invalid JSON received from signaling channel.`,
      );
      return;
    }

    if (typeof rpc.method === 'string') {
      if (typeof rpc.id === 'number') {
        await this.handleRpcRequest(rpc.id, rpc.method, rpc.params ?? []);
      } else {
        this.handleNotification(rpc.method, rpc.params ?? []);
      }
      return;
    }

    if (typeof rpc.id === 'number') {
      this.handleRpcResponse(rpc);
    }
  }

  private async handleRpcRequest(id: number, method: string, params: unknown[]): Promise<void> {
    switch (method) {
      case this.authMethod: {
        try {
          const authData = this.createAuthResponse(params);
          this.sendRpcSuccess(id, authData);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.sendRpcError(id, -32062, 'Invalid params', message);
          this.rejectReadyPromise(new Error(message));
        }
        return;
      }
      case 'addIceCandidate': {
        await this.onRemoteIceCandidate(params);
        this.sendRpcSuccess(id);
        return;
      }
      case 'reachMode': {
        this.sendRpcSuccess(id, [0]);
        return;
      }
      default:
        this.sendRpcError(id, -32061, `Method not found: ${method}`);
        return;
    }
  }

  private handleNotification(method: string, _params: unknown[]): void {
    if (method === 'ready') {
      this.clearAuthTimers();
      this.resolveReadyPromise();
      return;
    }

    if (method === 'kick' && !this.stopped) {
      this.options.platform.log.debug(`[${this.options.cameraName}] Loxone signaling kick received.`);
    }
  }

  private handleRpcResponse(rpc: JsonRpcMessage): void {
    if (typeof rpc.id !== 'number') {
      return;
    }

    const pending = this.pendingRpc.get(rpc.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRpc.delete(rpc.id);

    if (rpc.error) {
      pending.reject(new Error(`${pending.method}: ${rpc.error.message}`));
      return;
    }

    pending.resolve(rpc.result?.data);
  }

  private async onRemoteIceCandidate(params: unknown[]): Promise<void> {
    if (!this.wrtc || !this.peerConnection) {
      return;
    }

    const candidateStr = this.stringValue(params[0]);
    if (!candidateStr) {
      return;
    }

    const init: RtcIceCandidateInitLike = {
      candidate: candidateStr,
      sdpMLineIndex: this.numberValue(params[1]),
    };

    const sdpMid = this.stringValue(params[2]);
    if (sdpMid) {
      init.sdpMid = sdpMid;
    }

    const usernameFragment = this.stringValue(params[3]);
    if (usernameFragment) {
      init.usernameFragment = usernameFragment;
    }

    const candidate = new this.wrtc.RTCIceCandidate(init);
    if (this.peerReady) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.platform.log.debug(
          `[${this.options.cameraName}] Failed to add remote ICE candidate: ${message}`,
        );
      }
    } else {
      this.remoteIceQueue.push(candidate);
    }
  }

  private createAuthResponse(params: unknown[]): [string, string, string] {
    this.clearAuthTimers();
    this.authChallengeTimer = setTimeout(() => {
      this.rejectReadyPromise(new Error('Timeout: signaling authentication'));
    }, this.rpcTimeoutMs);

    const sessionToken = this.stringValue(params[0]);
    const modulus = this.stringValue(params[1]);
    const exponent = this.stringValue(params[2]);
    const fullPublicKey = this.stringValue(params[3]);
    const communicationToken = this.options.getToken();

    if (!sessionToken) {
      throw new Error('Missing signaling session token');
    }
    if (!communicationToken) {
      throw new Error('No active Loxone communication token available');
    }

    const aesKey = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
    const encryptedToken = Buffer.concat([
      cipher.update(communicationToken, 'utf8'),
      cipher.final(),
    ]).toString('base64');

    const rsaPayload = `${aesKey.toString('hex')}:${iv.toString('hex')}:${sessionToken}`;
    const publicKey = this.createRsaPublicKey(modulus, exponent, fullPublicKey);
    const rsaEncrypted = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(rsaPayload, 'utf8'),
    ).toString('base64');

    return [this.options.username, rsaEncrypted, encryptedToken];
  }

  private createRsaPublicKey(
    modulus?: string,
    exponent?: string,
    fullPublicKey?: string,
  ): KeyObject {
    if (fullPublicKey) {
      return createPublicKey(fullPublicKey);
    }

    if (!modulus || !exponent) {
      throw new Error('Missing RSA key parameters from signaling challenge');
    }

    const jwk = {
      kty: 'RSA',
      n: this.hexToBase64Url(modulus),
      e: this.hexToBase64Url(exponent),
    };

    return createPublicKey({
      key: jwk,
      format: 'jwk',
    });
  }

  private async callRpc(method: string, params?: unknown[] | null): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Socket not ready for method: ${method}`);
    }

    const id = this.rpcId++;
    const rpc: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      id,
    };

    if (Array.isArray(params)) {
      rpc.params = params;
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, this.rpcTimeoutMs);

      this.pendingRpc.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });

      this.sendJson(rpc);
    });
  }

  private async sendNotification(method: string, params?: unknown[] | null): Promise<void> {
    const rpc: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
    };
    if (Array.isArray(params)) {
      rpc.params = params;
    }
    this.sendJson(rpc);
  }

  private sendRpcSuccess(id: number, data?: unknown): void {
    const result: { code: number; message: string; data?: unknown } = {
      code: 200,
      message: 'Ok',
    };
    if (data !== undefined) {
      result.data = data;
    }

    this.sendJson({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private sendRpcError(id: number, code: number, message: string, data?: unknown): void {
    this.sendJson({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    });
  }

  private sendJson(payload: JsonRpcMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not open');
    }
    this.socket.send(JSON.stringify(payload));
  }

  private rejectAllPendingRpc(error: Error): void {
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRpc.clear();
  }

  private resolveReadyPromise(): void {
    if (this.resolveReady) {
      this.resolveReady();
    }
    this.resolveReady = undefined;
    this.rejectReady = undefined;
  }

  private rejectReadyPromise(error: Error): void {
    if (this.rejectReady) {
      this.rejectReady(error);
    }
    this.resolveReady = undefined;
    this.rejectReady = undefined;
  }

  private clearAuthTimers(): void {
    if (this.authChallengeTimer) {
      clearTimeout(this.authChallengeTimer);
      this.authChallengeTimer = undefined;
    }
  }

  private toWsUrl(baseUrl: string): string {
    return baseUrl.replace(/^https?:\/\//i, (protocol) =>
      protocol.toLowerCase() === 'https://' ? 'wss://' : 'ws://',
    );
  }

  private normalizeSessionDescription(value: unknown): RtcSessionDescriptionInitLike {
    if (!value || typeof value !== 'object') {
      throw new Error('Invalid remote SDP response');
    }

    const objectValue = value as Record<string, unknown>;
    const type = this.stringValue(objectValue.type);
    if (!type) {
      throw new Error('Remote SDP response missing type');
    }

    const sdp = this.stringValue(objectValue.sdp) ?? '';
    return { type, sdp };
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === 'string') {
      return data;
    }

    if (Buffer.isBuffer(data)) {
      return data.toString('utf8');
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }

    return Buffer.from(data).toString('utf8');
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private hexToBase64Url(hex: string): string {
    const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
    return Buffer.from(normalized, 'hex')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private loadWrtcModule(): WrtcModuleLike {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const moduleValue = require('wrtc') as WrtcModuleLike;
    if (!moduleValue?.RTCPeerConnection) {
      throw new Error('wrtc module does not expose RTCPeerConnection');
    }
    return moduleValue;
  }
}
